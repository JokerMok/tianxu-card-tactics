/** Validated first-level data; no caller-supplied combat state or numeric overrides. */
export interface CampaignLevel {
  readonly id: 'L01';
  readonly enemyDeckId: string;
  readonly scenarioRules: {
    readonly playerHeroHp: number;
    readonly activeLaneCount: number;
    readonly playerSummonSlots: number;
    readonly unlockSecondLaneOnFirstDeployment: boolean;
    readonly openingSkillCardsAllowed: boolean;
    readonly enemyOpeningCardFilter: 'UNITS_ONLY';
  };
}
export function validateCampaignLevel(value: unknown): CampaignLevel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('L01 configuration missing');
  const row = value as Record<string, unknown>;
  if (row.id !== 'L01' || typeof row.enemyDeckId !== 'string') throw new Error('Only L01 is supported');
  if (!row.scenarioRules || typeof row.scenarioRules !== 'object') throw new Error('L01 scenario rules missing');
  const rules = row.scenarioRules as Record<string, unknown>;
  for (const key of ['playerHeroHp','activeLaneCount','playerSummonSlots']) {
    if (typeof rules[key] !== 'number' || !Number.isSafeInteger(rules[key]) || rules[key] < 1) throw new Error(`L01 ${key} invalid`);
  }
  if (Number(rules.activeLaneCount)>2 || Number(rules.playerSummonSlots)>3
    || typeof rules.unlockSecondLaneOnFirstDeployment!=='boolean' || typeof rules.openingSkillCardsAllowed!=='boolean'
    || rules.enemyOpeningCardFilter!=='UNITS_ONLY') throw new Error('L01 scenario rules invalid');
  return Object.freeze({id:'L01',enemyDeckId:row.enemyDeckId,scenarioRules:Object.freeze({
    playerHeroHp:Number(rules.playerHeroHp),activeLaneCount:Number(rules.activeLaneCount),playerSummonSlots:Number(rules.playerSummonSlots),
    unlockSecondLaneOnFirstDeployment:rules.unlockSecondLaneOnFirstDeployment,openingSkillCardsAllowed:rules.openingSkillCardsAllowed,enemyOpeningCardFilter:'UNITS_ONLY',
  })});
}

export function campaignDeckProfession(config:unknown,deckId:string):string {
  if(!config||typeof config!=='object')throw new Error('campaign configuration missing');
  const value=config as Record<string,unknown>;
  if(!Array.isArray(value.decks))throw new Error('campaign decks missing');
  const deck=value.decks.find((row:unknown)=>!!row&&typeof row==='object'&&'id' in row&&row.id===deckId);
  if(!deck||typeof deck!=='object'||!('profession' in deck)||typeof deck.profession!=='string'||!['P001','P002','P003','P004'].includes(deck.profession))throw new Error('campaign profession invalid');
  return deck.profession;
}
