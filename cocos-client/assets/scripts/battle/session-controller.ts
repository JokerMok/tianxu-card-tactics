import {
  BATTLE_RUNNER_PROTOCOL,
  runBattleRunner,
  type BattleRunnerOutput,
  type HighLevelAction,
} from './runner/battle-runner.ts';
import type { BattleEvent, BattleState } from '../../core/types/index.ts';

export type BattleSessionLifecycle = 'idle' | 'active' | 'paused' | 'ended';

export interface BattleSessionOptions {
  readonly seed: number;
}
export interface BattleSessionSnapshot {
  readonly lifecycle: BattleSessionLifecycle;
  readonly seed: number;
  readonly actions: readonly HighLevelAction[];
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly eventsConsumed: number;
  readonly finalHash: string;
}

export type BattleSessionErrorCode = 'INVALID_LIFECYCLE' | 'INVALID_COMMAND';

export class BattleSessionError extends Error {
  readonly code: BattleSessionErrorCode;

  constructor(code: BattleSessionErrorCode, message: string) {
    super(message);
    this.name = 'BattleSessionError';
    this.code = code;
  }
}

function freezeAction(action: HighLevelAction): HighLevelAction {
  return Object.freeze({ ...action });
}

function freezeActions(actions: readonly HighLevelAction[]): readonly HighLevelAction[] {
  return Object.freeze(actions.map(freezeAction));
}

function input(seed: number, actions: readonly HighLevelAction[]): {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL;
  readonly seed: number;
  readonly actions: readonly HighLevelAction[];
} {
  return { protocol: BATTLE_RUNNER_PROTOCOL, seed, actions };
}

/**
 * Owns the lifecycle around the deterministic Cocos battle runner.
 * Rendering and input policy stay outside this controller.
 */
export class BattleSessionController {
  private readonly seedValue: number;
  private lifecycleValue: BattleSessionLifecycle = 'idle';
  private actionsValue: readonly HighLevelAction[] = Object.freeze([]);
  private output: BattleRunnerOutput;
  private eventsConsumedValue = 0;
  private snapshotValue: BattleSessionSnapshot;

  constructor(options: BattleSessionOptions | number) {
    this.seedValue = typeof options === 'number' ? options : options.seed;
    this.output = runBattleRunner(input(this.seedValue, this.actionsValue));
    this.snapshotValue = this.createSnapshot();
  }

  get lifecycle(): BattleSessionLifecycle {
    return this.lifecycleValue;
  }

  get state(): BattleState {
    return this.output.finalState;
  }

  get snapshot(): BattleSessionSnapshot {
    return this.snapshotValue;
  }

  start(): BattleSessionSnapshot {
    this.requireLifecycle('idle', 'start');
    this.execute({ type: 'BATTLE_START' });
    this.lifecycleValue = 'active';
    this.refreshSnapshot();
    return this.snapshotValue;
  }

  dispatch(action: HighLevelAction): BattleSessionSnapshot {
    this.requireLifecycle('active', 'dispatch');
    if (action.type === 'BATTLE_START') {
      throw new BattleSessionError('INVALID_COMMAND', 'BATTLE_START must be issued by start()');
    }
    this.execute(action);
    if (this.output.finalState.status !== 'playing') this.lifecycleValue = 'ended';
    this.refreshSnapshot();
    return this.snapshotValue;
  }

  consumeEvents(): readonly BattleEvent[] {
    const events = this.output.events.slice(this.eventsConsumedValue);
    this.eventsConsumedValue = this.output.events.length;
    this.refreshSnapshot();
    return Object.freeze(events);
  }

  pause(): BattleSessionSnapshot {
    this.requireLifecycle('active', 'pause');
    this.lifecycleValue = 'paused';
    this.refreshSnapshot();
    return this.snapshotValue;
  }

  resume(): BattleSessionSnapshot {
    this.requireLifecycle('paused', 'resume');
    this.lifecycleValue = 'active';
    this.refreshSnapshot();
    return this.snapshotValue;
  }

  end(): BattleSessionSnapshot {
    if (this.lifecycleValue === 'ended') return this.snapshotValue;
    if (this.lifecycleValue !== 'active' && this.lifecycleValue !== 'paused') {
      throw new BattleSessionError('INVALID_LIFECYCLE', `cannot end a ${this.lifecycleValue} session`);
    }
    this.lifecycleValue = 'ended';
    this.refreshSnapshot();
    return this.snapshotValue;
  }

  private execute(action: HighLevelAction): void {
    const nextActions = [...this.actionsValue, freezeAction(action)];
    const nextOutput = runBattleRunner(input(this.seedValue, nextActions));
    this.actionsValue = freezeActions(nextActions);
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
}
