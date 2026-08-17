export const BATTLE_EXIT_STATES = Object.freeze({
  ACTIVE: 'active',
  CONFIRMING: 'confirming',
  TERMINAL: 'terminal',
  FAILED: 'failed',
} as const);

export type BattleExitState = typeof BATTLE_EXIT_STATES[keyof typeof BATTLE_EXIT_STATES];
export type BattleExitReason = 'surrender' | 'abnormal';
export type BattleExitCode = 'CONFIRMING' | 'CANCELLED' | 'SETTLED' | 'FAILED' | 'BOUND' | 'UNBOUND' | 'IGNORED' | 'INVALID_HOST';

export interface BattleExitRequest {
  readonly reason: BattleExitReason;
}

export interface BattleExitSettlementPort {
  settle(request: BattleExitRequest): unknown;
}

/** A host entry only needs to register a click listener and return optional cleanup. */
export interface BattleExitTopEntry {
  subscribeClick(listener: () => void): (() => void) | void;
}

export interface BattleExitControllerOptions {
  readonly port?: BattleExitSettlementPort;
}

export interface BattleExitSnapshot {
  readonly state: BattleExitState;
  readonly terminal: boolean;
  readonly failed: boolean;
  readonly settled: boolean;
  readonly reason: BattleExitReason | null;
}

export interface BattleExitResult {
  readonly accepted: boolean;
  readonly code: BattleExitCode;
  readonly snapshot: BattleExitSnapshot;
}

/**
 * Runtime-neutral boundary for surrender confirmation and abnormal battle exits.
 * Settlement is delegated to an injected port so this controller owns no rewards
 * or session lifecycle policy.
 */
export class BattleExitController {
  private portValue: BattleExitSettlementPort | null = null;
  private stateValue: BattleExitState = 'active';
  private reasonValue: BattleExitReason | null = null;
  private settledValue = false;
  private bindingValue = 0;
  private cleanupValue: (() => void) | null = null;
  private snapshotValue: BattleExitSnapshot;

  constructor(options: BattleExitControllerOptions | unknown = {}) {
    try {
      const candidate = options !== null && typeof options === 'object'
        ? (options as { readonly port?: unknown }).port
        : null;
      if (
        candidate !== null
        && typeof candidate === 'object'
        && typeof (candidate as { readonly settle?: unknown }).settle === 'function'
      ) {
        this.portValue = candidate as BattleExitSettlementPort;
      }
    } catch {
      this.portValue = null;
    }
    this.snapshotValue = this.createSnapshot();
  }

  get snapshot(): BattleExitSnapshot {
    return this.snapshotValue;
  }

  bindTopEntry(entry: BattleExitTopEntry | unknown): BattleExitResult {
    this.unbind();
    try {
      if (entry === null || typeof entry !== 'object') return this.result(false, 'INVALID_HOST');
      const subscribe = (entry as { readonly subscribeClick?: unknown }).subscribeClick;
      if (typeof subscribe !== 'function') return this.result(false, 'INVALID_HOST');
      const binding = this.bindingValue + 1;
      this.bindingValue = binding;
      const cleanup = subscribe.call(entry, () => {
        if (this.bindingValue !== binding) return;
        this.requestSurrender();
      });
      this.cleanupValue = typeof cleanup === 'function' ? cleanup : null;
      return this.result(true, 'BOUND');
    } catch {
      this.bindingValue += 1;
      this.cleanupValue = null;
      return this.result(false, 'INVALID_HOST');
    }
  }

  unbindTopEntry(): BattleExitResult {
    this.unbind();
    return this.result(true, 'UNBOUND');
  }

  requestSurrender(): BattleExitResult {
    if (this.stateValue !== 'active') return this.result(false, 'IGNORED');
    this.stateValue = 'confirming';
    this.publish();
    return this.result(true, 'CONFIRMING');
  }

  cancel(): BattleExitResult {
    if (this.stateValue !== 'confirming') return this.result(false, 'IGNORED');
    this.stateValue = 'active';
    this.publish();
    return this.result(true, 'CANCELLED');
  }

  confirm(): BattleExitResult {
    if (this.stateValue !== 'confirming') return this.result(false, 'IGNORED');
    return this.settle('surrender');
  }

  abnormalExit(): BattleExitResult {
    if (this.stateValue !== 'active' && this.stateValue !== 'confirming') return this.result(false, 'IGNORED');
    return this.settle('abnormal');
  }

  private settle(reason: BattleExitReason): BattleExitResult {
    if (this.settledValue) return this.result(false, 'IGNORED');
    this.settledValue = true;
    this.reasonValue = reason;
    this.stateValue = 'terminal';
    this.publish();
    try {
      if (this.portValue === null) throw new Error('battle exit settlement port is unavailable');
      this.portValue.settle(Object.freeze({ reason }));
      return this.result(true, 'SETTLED');
    } catch {
      this.stateValue = 'failed';
      this.publish();
      return this.result(true, 'FAILED');
    }
  }

  private unbind(): void {
    const cleanup = this.cleanupValue;
    this.cleanupValue = null;
    this.bindingValue += 1;
    try {
      if (cleanup) cleanup();
    } catch {
      // Host cleanup is best-effort and must not affect the battle exit state.
    }
  }

  private createSnapshot(): BattleExitSnapshot {
    return Object.freeze({
      state: this.stateValue,
      terminal: this.stateValue === 'terminal' || this.stateValue === 'failed',
      failed: this.stateValue === 'failed',
      settled: this.stateValue === 'terminal',
      reason: this.reasonValue,
    });
  }

  private publish(): void {
    this.snapshotValue = this.createSnapshot();
  }

  private result(accepted: boolean, code: BattleExitCode): BattleExitResult {
    return Object.freeze({ accepted, code, snapshot: this.snapshotValue });
  }
}
