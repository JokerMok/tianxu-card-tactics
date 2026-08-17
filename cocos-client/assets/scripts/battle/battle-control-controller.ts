import type { BattleSessionAction, BattleSessionSnapshot } from './session-controller.ts';
import type { BattleTarget } from './action-contract.ts';

export interface BattleControlSession {
  readonly snapshot: BattleSessionSnapshot | { readonly revision?: number };
  dispatch(action: BattleSessionAction): unknown;
  isActionLegal?(action: BattleSessionAction): boolean;
}

export interface BattleControlToken {
  readonly sessionRevision: number | null;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly paused: boolean;
  readonly invalidation: number;
}

export interface BattleControlSnapshot {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly paused: boolean;
  readonly speed: number;
  readonly invalidation: number;
  readonly queuedActions: readonly BattleSessionAction[];
}

export interface BattleControlTickResult {
  readonly dispatched: boolean;
  readonly action: BattleSessionAction | null;
}

export interface BattleControlControllerOptions {
  readonly session: BattleControlSession;
  readonly strategy?: (snapshot: BattleSessionSnapshot | { readonly revision?: number }) => unknown;
  readonly normalizeAction?: (candidate: unknown, snapshot: BattleSessionSnapshot | { readonly revision?: number }) => unknown;
  readonly isActionLegal?: (action: BattleSessionAction, snapshot: BattleSessionSnapshot | { readonly revision?: number }) => boolean;
  readonly enabled?: boolean;
  readonly visible?: boolean;
  readonly paused?: boolean;
  /** Presentation-only multiplier. It never affects strategy or action dispatch. */
  readonly speed?: number;
}

type QueuedAction = { readonly action: BattleSessionAction; readonly token: BattleControlToken };

function ownEnumerableKeys(value: object): string[] | null {
  try {
    const keys = Object.keys(value);
    return keys.every((key) => typeof key === 'string') ? keys : null;
  } catch {
    return null;
  }
}

function hasOnly(keys: readonly string[], expected: readonly string[]): boolean {
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function side(value: unknown): value is 'player' | 'enemy' {
  return value === 'player' || value === 'enemy';
}

function index(value: unknown): value is number {
  return Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function cloneTarget(value: unknown): BattleTarget | null {
  if (!record(value)) return null;
  const keys = ownEnumerableKeys(value);
  if (!keys) return null;
  try {
    if (value.kind === 'global' && hasOnly(keys, ['kind'])) return Object.freeze({ kind: 'global' } as const);
    if (value.kind === 'lane' && hasOnly(keys, ['kind', 'lane']) && index(value.lane)) {
      return Object.freeze({ kind: 'lane', lane: value.lane } as const);
    }
    if (value.kind === 'cell' && hasOnly(keys, ['kind', 'lane', 'cell']) && index(value.lane) && index(value.cell)) {
      return Object.freeze({ kind: 'cell', lane: value.lane, cell: value.cell } as const);
    }
    if (value.kind === 'unit' && hasOnly(keys, ['kind', 'unitId']) && text(value.unitId)) {
      return Object.freeze({ kind: 'unit', unitId: value.unitId } as const);
    }
  } catch {
    return null;
  }
  return null;
}

function cloneAction(value: unknown): BattleSessionAction | null {
  if (!record(value)) return null;
  const keys = ownEnumerableKeys(value);
  if (!keys) return null;
  try {
    if (value.type === 'BATTLE_START' && hasOnly(keys, ['type'])) return Object.freeze({ type: 'BATTLE_START' });
    if (
      value.type === 'DEPLOY_UNIT'
      && hasOnly(keys, ['type', 'cardId', 'side', 'lane', 'cell'])
      && text(value.cardId) && side(value.side) && index(value.lane) && index(value.cell)
    ) {
      return Object.freeze({ type: 'DEPLOY_UNIT', cardId: value.cardId, side: value.side, lane: value.lane, cell: value.cell });
    }
    if (value.type === 'PLAY_CARD' && hasOnly(keys, ['type', 'cardId', 'side', 'target']) && text(value.cardId) && side(value.side)) {
      const target = cloneTarget(value.target);
      return target === null ? null : Object.freeze({ type: 'PLAY_CARD', cardId: value.cardId, side: value.side, target });
    }
    if (value.type === 'MOVE_UNIT' && hasOnly(keys, ['type', 'unitId']) && text(value.unitId)) {
      return Object.freeze({ type: 'MOVE_UNIT', unitId: value.unitId });
    }
    if (value.type === 'MOVE_UNIT' && hasOnly(keys, ['type', 'unitId', 'steps']) && text(value.unitId) && index(value.steps)) {
      return Object.freeze({ type: 'MOVE_UNIT', unitId: value.unitId, steps: value.steps });
    }
    if (value.type === 'ATTACK' && hasOnly(keys, ['type', 'attackerId']) && text(value.attackerId)) {
      return Object.freeze({ type: 'ATTACK', attackerId: value.attackerId });
    }
    if (value.type === 'END_TURN' && hasOnly(keys, ['type'])) return Object.freeze({ type: 'END_TURN' });
  } catch {
    return null;
  }
  return null;
}

/**
 * Runtime-neutral policy coordinator. It owns no timers and treats every strategy
 * output as untrusted data until it is copied, frozen, and revalidated.
 */
export class BattleControlController {
  readonly session: BattleControlSession;
  private strategyValue: BattleControlControllerOptions['strategy'];
  private readonly normalizer: BattleControlControllerOptions['normalizeAction'];
  private readonly legal: BattleControlControllerOptions['isActionLegal'];
  private enabledValue: boolean;
  private visibleValue: boolean;
  private pausedValue: boolean;
  private speedValue: number;
  private invalidationValue = 0;
  private queue: QueuedAction[] = [];

  constructor(options: BattleControlControllerOptions) {
    this.session = options.session;
    this.strategyValue = options.strategy;
    this.normalizer = options.normalizeAction;
    this.legal = options.isActionLegal;
    this.enabledValue = options.enabled ?? true;
    this.visibleValue = options.visible ?? true;
    this.pausedValue = options.paused ?? false;
    this.speedValue = typeof options.speed === 'number' && Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
  }

  get enabled(): boolean { return this.enabledValue; }
  get visible(): boolean { return this.visibleValue; }
  get paused(): boolean { return this.pausedValue; }
  get speed(): number { return this.speedValue; }
  get invalidation(): number { return this.invalidationValue; }
  get queuedActions(): readonly BattleSessionAction[] { return Object.freeze(this.queue.map(({ action }) => action)); }
  get snapshot(): BattleControlSnapshot {
    return Object.freeze({
      enabled: this.enabledValue,
      visible: this.visibleValue,
      paused: this.pausedValue,
      speed: this.speedValue,
      invalidation: this.invalidationValue,
      queuedActions: this.queuedActions,
    });
  }

  setStrategy(strategy: BattleControlControllerOptions['strategy']): void {
    this.strategyValue = strategy;
    this.invalidate();
  }

  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.speedValue = speed;
  }

  enable(): void { this.enabledValue = true; this.invalidate(); }
  disable(): void { this.enabledValue = false; this.invalidate(); }
  show(): void { this.visibleValue = true; this.invalidate(); }
  hide(): void { this.visibleValue = false; this.invalidate(); }
  resume(): void { this.pausedValue = false; this.invalidate(); }
  pause(): void { this.pausedValue = true; this.invalidate(); }

  normalize(candidate: unknown): BattleSessionAction | null {
    try {
      const value = this.normalizer ? this.normalizer(candidate, this.session.snapshot) : candidate;
      return cloneAction(value);
    } catch {
      return null;
    }
  }

  isActionLegal(candidate: unknown): boolean {
    const action = this.normalize(candidate);
    return action !== null && this.isNormalizedActionLegal(action);
  }

  enqueue(candidate: unknown): boolean {
    const token = this.token();
    const action = this.normalize(candidate);
    if (!this.ready() || action === null || !this.isNormalizedActionLegal(action) || !this.valid(token)) return false;
    this.queue.push(Object.freeze({ action, token }));
    return true;
  }

  dispatch(candidate: unknown): boolean {
    const token = this.token();
    const action = this.normalize(candidate);
    if (!this.ready() || action === null || !this.isNormalizedActionLegal(action) || !this.valid(token)) return false;
    return this.dispatchNormalized(action, token);
  }

  tick(): BattleControlTickResult {
    const queued = this.queue[0];
    if (queued) {
      if (!this.ready() || !this.valid(queued.token)) {
        this.clearQueue();
        return this.result(false);
      }
      this.queue.shift();
      return this.dispatchNormalized(queued.action, queued.token) ? this.result(true, queued.action) : this.result(false);
    }
    if (!this.ready() || !this.strategyValue) return this.result(false);

    const token = this.token();
    let candidate: unknown;
    try {
      candidate = this.strategyValue(this.session.snapshot);
    } catch {
      this.clearQueue();
      return this.result(false);
    }
    if (!this.valid(token)) {
      this.clearQueue();
      return this.result(false);
    }

    const action = this.normalize(candidate);
    if (action === null || !this.valid(token) || !this.isNormalizedActionLegal(action)) {
      this.clearQueue();
      return this.result(false);
    }
    if (!this.valid(token)) {
      this.clearQueue();
      return this.result(false);
    }
    this.queue.push(Object.freeze({ action, token }));
    if (!this.valid(token)) {
      this.clearQueue();
      return this.result(false);
    }
    this.queue.shift();
    return this.dispatchNormalized(action, token) ? this.result(true, action) : this.result(false);
  }

  private token(): BattleControlToken {
    return Object.freeze({
      sessionRevision: this.revision(),
      enabled: this.enabledValue,
      visible: this.visibleValue,
      paused: this.pausedValue,
      invalidation: this.invalidationValue,
    });
  }

  private valid(token: BattleControlToken): boolean {
    return token.sessionRevision === this.revision()
      && token.enabled === this.enabledValue
      && token.visible === this.visibleValue
      && token.paused === this.pausedValue
      && token.invalidation === this.invalidationValue;
  }

  private revision(): number | null {
    try {
      const value = this.session.snapshot.revision;
      return Number.isSafeInteger(value) ? value : null;
    } catch {
      return null;
    }
  }

  private ready(): boolean {
    return this.enabledValue && this.visibleValue && !this.pausedValue;
  }

  private isNormalizedActionLegal(action: BattleSessionAction): boolean {
    try {
      if (action.type === 'BATTLE_START') return false;
      if (this.legal) return this.legal(action, this.session.snapshot) === true;
      return this.session.isActionLegal ? this.session.isActionLegal(action) === true : true;
    } catch {
      return false;
    }
  }

  private dispatchNormalized(action: BattleSessionAction, token: BattleControlToken): boolean {
    if (!this.ready() || !this.valid(token)) {
      this.clearQueue();
      return false;
    }
    try {
      this.session.dispatch(action);
      return true;
    } catch {
      this.clearQueue();
      return false;
    }
  }

  private clearQueue(): void {
    this.queue = [];
  }

  private invalidate(): void {
    this.invalidationValue += 1;
    this.clearQueue();
  }

  private result(dispatched: boolean, action: BattleSessionAction | null = null): BattleControlTickResult {
    return Object.freeze({ dispatched, action });
  }
}
