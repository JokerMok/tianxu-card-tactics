import type {
  BattleEvent, BattleEventPoint, BattleEventUnitView, BattleState, BattleUnit,
} from './GameContracts.ts';

export type BattlePresentationStepKind =
  | 'move'
  | 'attack'
  | 'impact'
  | 'summon'
  | 'death'
  | 'remove'
  | 'effect'
  | 'settle';

export type BattlePresentationCue = 'impact';

export interface BattlePresentationFrame {
  actor?: BattleEventUnitView;
  target?: BattleEventUnitView;
}

export interface BattlePresentationHpChange {
  eventSeq: number;
  unitId: string;
  before: number;
  after: number;
  amount: number;
  message?: string;
}

export interface BattlePresentationStep {
  token: string;
  kind: BattlePresentationStepKind;
  firstSeq: number;
  lastSeq: number;
  actorId?: string;
  targetId?: string;
  before: BattlePresentationFrame;
  after: BattlePresentationFrame;
  moveFrom?: BattleEventPoint;
  moveTo?: BattleEventPoint;
  hpChanges: readonly BattlePresentationHpChange[];
  requiredCues: readonly BattlePresentationCue[];
  events: readonly BattleEvent[];
}

export interface BattlePresentationSyncOptions {
  /** Refresh/re-entry policy: accept the current server snapshot as a new visible baseline. */
  baseline?: boolean;
}

export interface BattlePresentationSyncResult {
  mode: 'baseline' | 'queued' | 'reconciled' | 'duplicate' | 'stale';
  acceptedEvents: number;
  queuedSteps: number;
}

export interface BattlePresentationTraceEntry {
  index: number;
  type: 'baseline' | 'sync' | 'step-start' | 'cue' | 'step-complete' | 'reconcile' | 'ignored';
  revision: number;
  eventSeq?: number;
  token?: string;
  cue?: BattlePresentationCue;
  detail?: string;
}

export interface BattlePresentationReplayTrace {
  baseline?: BattleState;
  steps: readonly BattlePresentationStep[];
  trace: readonly BattlePresentationTraceEntry[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const unitView = (unit: BattleUnit | BattleEventUnitView | undefined): BattleEventUnitView | undefined => (
  unit ? clone(unit) : undefined
);

const findUnit = (state: BattleState, id: string | undefined): BattleUnit | undefined => (
  id ? state.units.find(unit => unit.id === id) : undefined
);

const frame = (state: BattleState, actorId?: string, targetId?: string): BattlePresentationFrame => ({
  ...(findUnit(state, actorId) ? { actor: unitView(findUnit(state, actorId)) } : {}),
  ...(findUnit(state, targetId) ? { target: unitView(findUnit(state, targetId)) } : {}),
});

const replaceUnit = (state: BattleState, view: BattleEventUnitView): void => {
  const next = clone(view) as BattleUnit;
  const index = state.units.findIndex(unit => unit.id === next.id);
  if (index >= 0) state.units[index] = next;
  else state.units.push(next);
};

const syncHeroHp = (state: BattleState, unit: BattleUnit): void => {
  if (unit.flags.hero !== 1) return;
  const owner = state.players.find(player => player.id === unit.playerId);
  if (owner) owner.hp = unit.hp;
};

const isImpactEvent = (event: BattleEvent): boolean => event.type === 'damage' || event.type === 'heal';
const ATTACK_FOLLOWUPS = new Set(['damage', 'heal', 'effect', 'status', 'skill']);
const PRESENTATION_EVENTS = new Set([
  'move', 'attack', 'damage', 'heal', 'summon', 'death', 'return-hand',
  'play', 'effect', 'status', 'skill', 'settled', 'terrain-add', 'terrain-update', 'terrain-remove',
]);

/**
 * Host-neutral queue separating authoritative snapshots from what the player is
 * currently allowed to see. No timer is owned here: a renderer advances the
 * queue only from real animation callbacks or promises through cue/complete.
 */
export class BattlePresentation {
  private authoritative?: BattleState;
  private visible?: BattleState;
  private projected?: BattleState;
  private baselineState?: BattleState;
  private acceptedSeq = 0;
  private stepSerial = 0;
  private traceSerial = 0;
  private pending: BattlePresentationStep[] = [];
  private active?: BattlePresentationStep;
  private activeCues = new Set<BattlePresentationCue>();
  private readonly traceEntries: BattlePresentationTraceEntry[] = [];
  private readonly replaySteps: BattlePresentationStep[] = [];

  get visibleState(): BattleState | undefined { return this.visible ? clone(this.visible) : undefined; }
  get locked(): boolean { return Boolean(this.active || this.pending.length); }
  get settledReady(): boolean { return !this.locked && this.visible?.status === 'settled'; }
  get trace(): readonly BattlePresentationTraceEntry[] { return clone(this.traceEntries); }
  get queuedStepCount(): number { return this.pending.length + (this.active ? 1 : 0); }

  replayTrace(): BattlePresentationReplayTrace {
    return {
      ...(this.baselineState ? { baseline: clone(this.baselineState) } : {}),
      steps: clone(this.replaySteps),
      trace: clone(this.traceEntries),
    };
  }

  bootstrap(snapshot: BattleState): BattlePresentationSyncResult {
    return this.sync(snapshot, { baseline: true });
  }

  sync(snapshot: BattleState, options: BattlePresentationSyncOptions = {}): BattlePresentationSyncResult {
    const incoming = clone(snapshot);
    if (options.baseline || !this.visible || this.visible.id !== incoming.id) {
      this.resetToBaseline(incoming, options.baseline ? 'explicit baseline' : 'new battle');
      return { mode: 'baseline', acceptedEvents: 0, queuedSteps: 0 };
    }
    if (this.authoritative && incoming.revision < this.authoritative.revision) {
      this.pushTrace('ignored', incoming.revision, undefined, undefined, undefined, 'stale revision');
      return { mode: 'stale', acceptedEvents: 0, queuedSteps: this.queuedStepCount };
    }

    this.authoritative = incoming;
    const events = incoming.events
      .filter(event => Number.isSafeInteger(event.seq) && event.seq > this.acceptedSeq)
      .sort((a, b) => a.seq - b.seq);
    if (!events.length) {
      if (!this.locked) {
        const changed = this.visible.revision !== incoming.revision;
        if (changed) this.reconcile();
        return { mode: changed ? 'reconciled' : 'duplicate', acceptedEvents: 0, queuedSteps: 0 };
      }
      return { mode: 'duplicate', acceptedEvents: 0, queuedSteps: this.queuedStepCount };
    }

    const previousStepCount = this.queuedStepCount;
    for (const event of events) this.acceptedSeq = Math.max(this.acceptedSeq, event.seq);
    const steps = this.buildSteps(events.filter(event => PRESENTATION_EVENTS.has(event.type)));
    this.pending.push(...steps);
    this.replaySteps.push(...clone(steps));
    this.pushTrace('sync', incoming.revision, events.at(-1)?.seq, undefined, undefined,
      `${events.length} events, ${steps.length} presentation steps`);
    if (!this.locked) this.reconcile();
    return { mode: steps.length ? 'queued' : 'reconciled', acceptedEvents: events.length, queuedSteps: this.queuedStepCount - previousStepCount };
  }

  /** Returns the active step until it is completed; it never skips a running animation. */
  nextStep(): BattlePresentationStep | undefined {
    if (this.active) return clone(this.active);
    const step = this.pending.shift();
    if (!step) {
      if (this.authoritative && this.visible?.revision !== this.authoritative.revision) this.reconcile();
      return undefined;
    }
    this.active = step;
    this.activeCues.clear();
    if (step.kind === 'summon') {
      for (const event of step.events) if (event.type === 'summon') this.applyEvent(this.visible!, event);
    }
    for (const event of step.events) if (event.type === 'terrain-add' || event.type === 'terrain-update') this.applyEvent(this.visible!, event);
    this.pushTrace('step-start', this.authoritative?.revision ?? this.visible?.revision ?? 0, step.firstSeq, step.token);
    return clone(step);
  }

  update(): BattlePresentationStep | undefined { return this.nextStep(); }

  cue(token: string, cue: BattlePresentationCue): boolean {
    if (!this.active || this.active.token !== token || !this.active.requiredCues.includes(cue)) return false;
    if (this.activeCues.has(cue)) return true;
    if (cue === 'impact') {
      for (const event of this.active.events) if (isImpactEvent(event) || event.type === 'status' || event.type === 'effect') {
        this.applyEvent(this.visible!, event);
      }
    }
    this.activeCues.add(cue);
    this.pushTrace('cue', this.authoritative?.revision ?? this.visible?.revision ?? 0, this.active.firstSeq, token, cue);
    return true;
  }

  complete(token: string): boolean {
    if (!this.active || this.active.token !== token) return false;
    if (this.active.requiredCues.some(cue => !this.activeCues.has(cue))) return false;
    const completed = this.active;
    for (const event of completed.events) this.applyEvent(this.visible!, event);
    this.active = undefined;
    this.activeCues.clear();
    this.pushTrace('step-complete', this.authoritative?.revision ?? this.visible?.revision ?? 0, completed.lastSeq, token);
    if (!this.pending.length) this.reconcile();
    return true;
  }

  private resetToBaseline(snapshot: BattleState, detail: string): void {
    this.authoritative = clone(snapshot);
    this.visible = clone(snapshot);
    this.projected = clone(snapshot);
    this.baselineState = clone(snapshot);
    this.acceptedSeq = snapshot.events.reduce((max, event) => Math.max(max, event.seq), 0);
    this.pending = [];
    this.active = undefined;
    this.activeCues.clear();
    this.stepSerial = 0;
    this.replaySteps.length = 0;
    this.traceEntries.length = 0;
    this.traceSerial = 0;
    this.pushTrace('baseline', snapshot.revision, this.acceptedSeq || undefined, undefined, undefined, detail);
  }

  private buildSteps(events: readonly BattleEvent[]): BattlePresentationStep[] {
    if (!this.projected) return [];
    const steps: BattlePresentationStep[] = [];
    for (let index = 0; index < events.length;) {
      const event = events[index]!;
      const group: BattleEvent[] = [event];
      if (event.type === 'attack') {
        while (index + group.length < events.length && ATTACK_FOLLOWUPS.has(events[index + group.length]!.type)) {
          group.push(events[index + group.length]!);
        }
      } else if (isImpactEvent(event)) {
        while (index + group.length < events.length && isImpactEvent(events[index + group.length]!)) {
          group.push(events[index + group.length]!);
        }
      }
      index += group.length;
      const beforeState = clone(this.projected);
      for (const item of group) this.applyEvent(this.projected, item);
      const afterState = clone(this.projected);
      const actorId = event.actor;
      const targetId = event.target;
      const hpChanges = this.hpChanges(group, beforeState);
      const kind = this.stepKind(event);
      const moveFrom = event.moveFrom ?? (kind === 'move' && actorId ? this.pointOf(beforeState, actorId) : undefined);
      const moveTo = event.moveTo ?? (kind === 'move' && actorId ? this.pointOf(afterState, actorId) : undefined);
      const step: BattlePresentationStep = {
        token: `${beforeState.id}:${event.seq}-${group.at(-1)!.seq}:${++this.stepSerial}`,
        kind,
        firstSeq: event.seq,
        lastSeq: group.at(-1)!.seq,
        ...(actorId ? { actorId } : {}),
        ...(targetId ? { targetId } : {}),
        before: frame(beforeState, actorId, targetId),
        after: frame(afterState, actorId, targetId),
        ...(moveFrom ? { moveFrom: clone(moveFrom) } : {}),
        ...(moveTo ? { moveTo: clone(moveTo) } : {}),
        hpChanges,
        requiredCues: hpChanges.length ? ['impact'] : [],
        events: clone(group),
      };
      steps.push(step);
    }
    return steps;
  }

  private hpChanges(events: readonly BattleEvent[], beforeState: BattleState): BattlePresentationHpChange[] {
    const hpByUnit = new Map(beforeState.units.map(unit => [unit.id, unit.hp]));
    const changes: BattlePresentationHpChange[] = [];
    for (const event of events) {
      if (!isImpactEvent(event) || !event.target) continue;
      const before = event.hpBefore ?? hpByUnit.get(event.target) ?? event.targetView?.hp;
      if (before === undefined) continue;
      const fallback = event.type === 'heal'
        ? before + Math.max(0, event.amount ?? 0)
        : Math.max(0, before - Math.max(0, event.effectiveAmount ?? event.amount ?? 0));
      const after = event.hpAfter ?? event.targetView?.hp ?? fallback;
      hpByUnit.set(event.target, after);
      changes.push({
        eventSeq: event.seq, unitId: event.target, before, after,
        amount: event.amount ?? Math.abs(after - before),
        ...(event.message ? { message: event.message } : {}),
      });
    }
    return changes;
  }

  private stepKind(event: BattleEvent): BattlePresentationStepKind {
    if (event.type === 'move') return 'move';
    if (event.type === 'attack') return 'attack';
    if (isImpactEvent(event)) return 'impact';
    if (event.type === 'summon') return 'summon';
    if (event.type === 'death') return 'death';
    if (event.type === 'return-hand') return 'remove';
    if (event.type === 'settled') return 'settle';
    return 'effect';
  }

  private pointOf(state: BattleState, id: string): BattleEventPoint | undefined {
    const unit = findUnit(state, id);
    return unit ? { row: unit.row, col: unit.col } : undefined;
  }

  private applyEvent(state: BattleState, event: BattleEvent): void {
    if (event.type === 'terrain-add' || event.type === 'terrain-update' || event.type === 'terrain-remove') {
      const id = event.terrainId ?? event.terrain?.id;
      if (!id) return;
      const terrains = (state.terrains ?? []).filter(terrain => terrain.id !== id);
      if (event.type !== 'terrain-remove' && event.terrain) terrains.push(clone(event.terrain));
      state.terrains = terrains;
      return;
    }
    if (event.type === 'summon' && event.target) {
      const view = event.targetView ?? this.authoritative?.units.find(unit => unit.id === event.target);
      if (view) replaceUnit(state, view);
      return;
    }
    if (event.type === 'move' && event.actor) {
      const unit = findUnit(state, event.actor);
      const to = event.moveTo ?? (event.row !== undefined && event.col !== undefined ? { row: event.row, col: event.col } : undefined);
      if (unit && to) { unit.row = to.row; unit.col = to.col; }
      return;
    }
    if (isImpactEvent(event) && event.target) {
      const unit = findUnit(state, event.target);
      if (!unit) return;
      if (event.hpAfter !== undefined) unit.hp = event.hpAfter;
      else if (event.targetView) unit.hp = event.targetView.hp;
      else if (event.type === 'heal') unit.hp = Math.min(unit.maxHp, unit.hp + Math.max(0, event.amount ?? 0));
      else unit.hp = Math.max(0, unit.hp - Math.max(0, event.effectiveAmount ?? event.amount ?? 0));
      syncHeroHp(state, unit);
      return;
    }
    if ((event.type === 'status' || event.type === 'effect') && event.targetView) {
      replaceUnit(state, event.targetView);
      return;
    }
    if ((event.type === 'death' && event.actor) || (event.type === 'return-hand' && event.actor)) {
      state.units = state.units.filter(unit => unit.id !== event.actor);
      return;
    }
    if (event.type === 'settled') {
      state.status = 'settled';
      state.winner = event.amount === 0 || event.amount === 1 ? event.amount : null;
    }
  }

  private reconcile(): void {
    if (!this.authoritative || this.locked) return;
    this.visible = clone(this.authoritative);
    this.projected = clone(this.authoritative);
    this.pushTrace('reconcile', this.authoritative.revision, this.acceptedSeq || undefined);
  }

  private pushTrace(
    type: BattlePresentationTraceEntry['type'], revision: number, eventSeq?: number,
    token?: string, cue?: BattlePresentationCue, detail?: string,
  ): void {
    this.traceEntries.push({
      index: ++this.traceSerial, type, revision,
      ...(eventSeq !== undefined ? { eventSeq } : {}),
      ...(token ? { token } : {}),
      ...(cue ? { cue } : {}),
      ...(detail ? { detail } : {}),
    });
  }
}
