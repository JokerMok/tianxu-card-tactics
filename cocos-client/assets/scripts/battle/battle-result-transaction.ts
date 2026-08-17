import {
  BattleResultTransactionService,
  type BattleResultTransactionResult,
  snapshotBattleValue,
} from '../services/BattleResultTransactionService.ts';

export { BattleResultTransactionService } from '../services/BattleResultTransactionService.ts';
export type { BattleProgress, BattleResultIntent, BattleResultState, BattleResultTransactionResult } from '../services/BattleResultTransactionService.ts';

function rejected(service: BattleResultTransactionService): BattleResultTransactionResult {
  return Object.freeze({ accepted: false, applied: false, code: 'INVALID', state: service.snapshot });
}

/** Defensive boundary for regular battle outcome templates. */
export class BattleResultTransactionPort {
  readonly service: BattleResultTransactionService;

  constructor(service: BattleResultTransactionService) {
    this.service = service;
  }

  settle(template: unknown): BattleResultTransactionResult {
    const snapshot = snapshotBattleValue(template);
    return snapshot === null ? rejected(this.service) : this.service.settleSnapshot(snapshot);
  }
}

/**
 * Adapter for BattleExitController.  The supplied exit template is not read until
 * settlement, when it is copied once before the request-derived outcome is built.
 */
export class BattleExitTransactionPort {
  readonly service: BattleResultTransactionService;
  private readonly template: unknown;

  constructor(service: BattleResultTransactionService, template: unknown) {
    this.service = service;
    this.template = template;
  }

  settle(request: unknown): BattleResultTransactionResult {
    const template = snapshotBattleValue(this.template);
    const exit = snapshotBattleValue(request);
    if (
      template === null
      || exit === null
      || typeof template !== 'object'
      || Array.isArray(template)
      || typeof exit !== 'object'
      || Array.isArray(exit)
      || Object.keys(exit).length !== 1
      || !Object.prototype.hasOwnProperty.call(exit, 'reason')
      || (exit.reason !== 'surrender' && exit.reason !== 'abnormal')
    ) return rejected(this.service);

    const keys = Object.keys(template);
    if (
      !['businessKey', 'nodeId', 'cost', 'progress'].every((key) => keys.includes(key))
      || keys.some((key) => !['businessKey', 'nodeId', 'cost', 'progress', 'outcome', 'reward'].includes(key))
    ) return rejected(this.service);
    const intent = {
      businessKey: template.businessKey,
      nodeId: template.nodeId,
      cost: template.cost,
      outcome: { kind: 'exit', reason: exit.reason },
      reward: {},
      progress: template.progress,
    };
    const intentSnapshot = snapshotBattleValue(intent);
    return intentSnapshot === null ? rejected(this.service) : this.service.settleSnapshot(intentSnapshot);
  }
}
