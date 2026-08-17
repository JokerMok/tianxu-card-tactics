import type { BattleEvent, BattleState } from '../../core/types/index.ts';
import type { BattlePlayCardAction } from './action-contract.ts';

export type { BattlePlayCardAction, BattleTarget } from './action-contract.ts';

export type BattleSessionLifecycle = 'idle' | 'active' | 'paused' | 'ended';

export type BattleSessionAction =
  | { readonly type: 'BATTLE_START' }
  | { readonly type: 'DEPLOY_UNIT'; readonly cardId: string; readonly side: 'player' | 'enemy'; readonly lane: number; readonly cell: number }
  | BattlePlayCardAction
  | { readonly type: 'MOVE_UNIT'; readonly unitId: string; readonly steps?: number }
  | { readonly type: 'ATTACK'; readonly attackerId: string }
  | { readonly type: 'END_TURN' };

export type HighLevelAction = BattleSessionAction;

export interface BattleSessionEngineOutput {
  readonly finalState: BattleState;
  readonly events: readonly BattleEvent[];
  readonly finalHash: string;
}

export interface BattleSessionEngine {
  run(seed: number, actions: readonly BattleSessionAction[]): BattleSessionEngineOutput;
}

export interface BattleSessionOptions {
  readonly seed: number;
  readonly engine: BattleSessionEngine;
}

export interface BattleSessionSnapshot {
  readonly revision: number;
  readonly lifecycle: BattleSessionLifecycle;
  readonly seed: number;
  readonly actions: readonly BattleSessionAction[];
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly eventsConsumed: number;
  readonly finalHash: string;
}

export type BattleSessionErrorCode = 'INVALID_LIFECYCLE' | 'INVALID_COMMAND' | 'INVALID_ENGINE';

export class BattleSessionError extends Error {
  readonly code: BattleSessionErrorCode;

  constructor(code: BattleSessionErrorCode, message: string) {
    super(message);
    this.name = 'BattleSessionError';
    this.code = code;
  }
}

function freezeValue<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}

function freezeAction(action: BattleSessionAction): BattleSessionAction {
  if (action.type === 'PLAY_CARD') {
    return Object.freeze({ ...action, target: Object.freeze({ ...action.target }) });
  }
  return Object.freeze({ ...action });
}

function freezeActions(actions: readonly BattleSessionAction[]): readonly BattleSessionAction[] {
  return Object.freeze(actions.map(freezeAction));
}

function freezeEngineOutput(output: BattleSessionEngineOutput): BattleSessionEngineOutput {
  if (
    output === null
    || typeof output !== 'object'
    || output.finalState === null
    || typeof output.finalState !== 'object'
    || !Array.isArray(output.events)
    || typeof output.finalHash !== 'string'
  ) {
    throw new BattleSessionError('INVALID_ENGINE', 'battle session engine returned an invalid output');
  }
  return Object.freeze({
    finalState: freezeValue(output.finalState),
    events: freezeValue([...output.events]),
    finalHash: output.finalHash,
  });
}

/**
 * Owns battle session lifecycle and delegates deterministic state transitions to an injected engine.
 * Rendering and input policy stay outside this controller.
 */
export class BattleSessionController {
  private readonly seedValue: number;
  private readonly engine: BattleSessionEngine;
  private lifecycleValue: BattleSessionLifecycle = 'idle';
  private actionsValue: readonly BattleSessionAction[] = Object.freeze([]);
  private output: BattleSessionEngineOutput;
  private eventsConsumedValue = 0;
  private revisionValue = 0;
  private snapshotValue: BattleSessionSnapshot;

  constructor(options: BattleSessionOptions);
  constructor(seed: number, engine: BattleSessionEngine);
  constructor(optionsOrSeed: BattleSessionOptions | number, positionalEngine?: BattleSessionEngine) {
    const options = typeof optionsOrSeed === 'number'
      ? { seed: optionsOrSeed, engine: positionalEngine }
      : optionsOrSeed;
    if (!options.engine || typeof options.engine.run !== 'function') {
      throw new BattleSessionError('INVALID_ENGINE', 'a battle session engine is required');
    }
    this.seedValue = options.seed;
    this.engine = options.engine;
    this.output = freezeEngineOutput(this.engine.run(this.seedValue, this.actionsValue));
    this.snapshotValue = this.createSnapshot();
  }

  get lifecycle(): BattleSessionLifecycle {
    return this.lifecycleValue;
  }

  get state(): BattleState {
    return this.output.finalState;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get snapshot(): BattleSessionSnapshot {
    return this.snapshotValue;
  }

  start(): BattleSessionSnapshot {
    this.requireLifecycle('idle', 'start');
    this.execute({ type: 'BATTLE_START' });
    this.lifecycleValue = 'active';
    this.advanceSnapshot();
    return this.snapshotValue;
  }

  dispatch(action: BattleSessionAction): BattleSessionSnapshot {
    this.requireLifecycle('active', 'dispatch');
    if (action.type === 'BATTLE_START') {
      throw new BattleSessionError('INVALID_COMMAND', 'BATTLE_START must be issued by start()');
    }
    this.execute(action);
    if (this.output.finalState.status !== 'playing') this.lifecycleValue = 'ended';
    this.advanceSnapshot();
    return this.snapshotValue;
  }

  /** Tests a command against the deterministic engine without committing it. */
  isActionLegal(action: BattleSessionAction): boolean {
    try {
      if (this.lifecycleValue !== 'active' || action.type === 'BATTLE_START') return false;
      const nextActions = freezeActions([...this.actionsValue, action]);
      freezeEngineOutput(this.engine.run(this.seedValue, nextActions));
      return true;
    } catch {
      return false;
    }
  }

  consumeEvents(): readonly BattleEvent[] {
    const events = this.output.events.slice(this.eventsConsumedValue);
    this.eventsConsumedValue = this.output.events.length;
    this.advanceSnapshot();
    return Object.freeze(events);
  }

  pause(): BattleSessionSnapshot {
    this.requireLifecycle('active', 'pause');
    this.lifecycleValue = 'paused';
    this.advanceSnapshot();
    return this.snapshotValue;
  }

  resume(): BattleSessionSnapshot {
    this.requireLifecycle('paused', 'resume');
    this.lifecycleValue = 'active';
    this.advanceSnapshot();
    return this.snapshotValue;
  }

  end(): BattleSessionSnapshot {
    if (this.lifecycleValue === 'ended') return this.snapshotValue;
    if (this.lifecycleValue !== 'active' && this.lifecycleValue !== 'paused') {
      throw new BattleSessionError('INVALID_LIFECYCLE', `cannot end a ${this.lifecycleValue} session`);
    }
    this.lifecycleValue = 'ended';
    this.advanceSnapshot();
    return this.snapshotValue;
  }

  private execute(action: BattleSessionAction): void {
    const nextActions = freezeActions([...this.actionsValue, action]);
    const nextOutput = freezeEngineOutput(this.engine.run(this.seedValue, nextActions));
    this.actionsValue = nextActions;
    this.output = nextOutput;
  }

  private requireLifecycle(expected: BattleSessionLifecycle, operation: string): void {
    if (this.lifecycleValue !== expected) {
      throw new BattleSessionError(
        'INVALID_LIFECYCLE',
        `${operation} is not allowed while session is ${this.lifecycleValue}`,
      );
    }
  }

  private createSnapshot(): BattleSessionSnapshot {
    return Object.freeze({
      revision: this.revisionValue,
      lifecycle: this.lifecycleValue,
      seed: this.seedValue,
      actions: this.actionsValue,
      state: this.output.finalState,
      events: this.output.events,
      eventsConsumed: this.eventsConsumedValue,
      finalHash: this.output.finalHash,
    });
  }

  private refreshSnapshot(): void {
    this.snapshotValue = this.createSnapshot();
  }

  private advanceSnapshot(): void {
    this.revisionValue += 1;
    this.refreshSnapshot();
  }
}
