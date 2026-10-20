import { campaignEffects } from './campaign-effects.ts';
import { createAuthority, type BattleConfigSelection } from './battle-config.ts';
import { createBattleRuntime } from './battle-core.ts';

export type { BattleConfig, BattleConfigSelection } from './battle-config.ts';
export type { BattleRunnerOutput, HighLevelAction, NeutralBattleOutput } from './battle-core.ts';
export { BATTLE_RUNNER, BATTLE_RUNNER_PROTOCOL, BATTLE_RUNNER_V2_PROTOCOL } from './battle-core.ts';

/** One validated, immutable configuration snapshot per factory. */
export function createBattleCore(config: unknown, selection: BattleConfigSelection = {}) {
  return createBattleRuntime(createAuthority(config, selection));
}

import { validateCampaignLevel, campaignDeckProfession } from './campaign-config.ts';
import type { HighLevelAction } from './battle-core.ts';

/** Campaign and legacy replay share primitives but retain separate protocol behavior. */
export function createCampaignCore(config: unknown, levelInput: unknown, selection: BattleConfigSelection = {}) {
  const level = validateCampaignLevel(levelInput);
  const authority = createAuthority(config, selection);
  const enemy = createAuthority(config, {deckId:level.enemyDeckId});
  const runtime = createBattleRuntime(authority);
  const effects = campaignEffects(config);
  const rows=(config as {strategies?:{levelId:string;unitIds:string[]}[]}).strategies;
  const openingPriority=rows?.find(row=>row.levelId===level.id)?.unitIds??[];
  if(openingPriority.some(id=>!enemy.deck.includes(id)))throw new Error('Enemy opening strategy references a card outside its deck');
  const professionId = campaignDeckProfession(config,selection.deckId??'D001');
  if(authority.deck.some(id=>{const card=authority.cards.find(c=>c.id===id)!;return card.cardType==='SKILL'&&!authority.professions.find(p=>p.id===professionId)?.skillIds.includes(id);}))throw new Error('Campaign deck has foreign profession skills');
  if (authority.deck.some(id => !authority.cards.some(c=>c.id===id&&c.cardType==='UNIT') && !effects.some(e=>e.cardId===id))) throw new Error('Unsupported campaign deck skill');
  return Object.freeze({
    level,
    deck: authority.deck,
    run: (seed: number, actions: readonly HighLevelAction[]) => runtime.runCampaign(seed, actions, level, enemy.deck, effects, professionId, openingPriority),
  });
}
