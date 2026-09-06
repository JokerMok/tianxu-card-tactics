import { createAuthority, type BattleConfigSelection } from './battle-config.ts';
import { createBattleRuntime } from './battle-core.ts';

export type { BattleConfig, BattleConfigSelection } from './battle-config.ts';
export type { BattleRunnerOutput, HighLevelAction, NeutralBattleOutput } from './battle-core.ts';
export { BATTLE_RUNNER, BATTLE_RUNNER_PROTOCOL, BATTLE_RUNNER_V2_PROTOCOL } from './battle-core.ts';

/** One validated, immutable configuration snapshot per factory. */
export function createBattleCore(config: unknown, selection: BattleConfigSelection = {}) {
  return createBattleRuntime(createAuthority(config, selection));
}
