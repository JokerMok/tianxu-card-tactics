import type { CardInstance, Side, Unit } from '../types/index.ts';

export type Profession = 'COMMANDER' | 'ARCANIST' | 'COVENANT' | 'TACTICIAN';
export type ProfessionTrigger =
  | 'BATTLE_START'
  | 'FIRST_DEPLOY_PER_LANE'
  | 'FIRST_SPELL_PER_ACTION'
  | 'FIRST_DOT_PER_ROUND';

export interface ProfessionTraitConfig {
  readonly profession: Profession;
  readonly traitId: string;
  readonly trigger: ProfessionTrigger;
  readonly effectIds: readonly string[];
  readonly perLaneLimit?: number;
  readonly perRoundLimit?: number;
  readonly perActionLimit?: number;
  readonly enabled: boolean;
}

export interface ProfessionEffect {
  readonly id: string;
  readonly operation: 'APPLY_BARRIER' | 'IGNORE_SPELL_RESIST' | 'REDUCE_DOT_DAMAGE' | 'REDUCE_PREPARATION';
  readonly value: number;
}

export const PROFESSION_EFFECTS: Readonly<Record<string, ProfessionEffect>> = freeze({
  E_TRAIT_BARRIER_2: { id: 'E_TRAIT_BARRIER_2', operation: 'APPLY_BARRIER', value: 2 },
  E_TRAIT_IGNORE_SPELL_RESIST_1: { id: 'E_TRAIT_IGNORE_SPELL_RESIST_1', operation: 'IGNORE_SPELL_RESIST', value: 1 },
  E_TRAIT_DOT_REDUCTION_1: { id: 'E_TRAIT_DOT_REDUCTION_1', operation: 'REDUCE_DOT_DAMAGE', value: 1 },
  E_TRAIT_PREPARATION_MINUS_1: { id: 'E_TRAIT_PREPARATION_MINUS_1', operation: 'REDUCE_PREPARATION', value: 1 },
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const PROFESSION_TRAITS: readonly ProfessionTraitConfig[] = freeze([
  { profession: 'COMMANDER', traitId: 'TRAIT_COMMAND', trigger: 'FIRST_DEPLOY_PER_LANE', effectIds: ['E_TRAIT_BARRIER_2'], perLaneLimit: 1, enabled: true },
  { profession: 'ARCANIST', traitId: 'TRAIT_ANALYSIS', trigger: 'FIRST_SPELL_PER_ACTION', effectIds: ['E_TRAIT_IGNORE_SPELL_RESIST_1'], perActionLimit: 1, enabled: true },
  { profession: 'COVENANT', traitId: 'TRAIT_OATH', trigger: 'FIRST_DOT_PER_ROUND', effectIds: ['E_TRAIT_DOT_REDUCTION_1'], perRoundLimit: 1, enabled: true },
  { profession: 'TACTICIAN', traitId: 'TRAIT_INITIATIVE', trigger: 'BATTLE_START', effectIds: ['E_TRAIT_PREPARATION_MINUS_1'], enabled: true },
]);

export interface ProfessionLog {
  readonly sequence: number;
  readonly profession: Profession;
  readonly traitId: string;
  readonly trigger: ProfessionTrigger;
  readonly effectIds: readonly string[];
  readonly objectIds: readonly string[];
  readonly round: number;
  readonly action: number;
}

export interface ProfessionState {
  readonly profession: Profession;
  readonly logs: readonly ProfessionLog[];
  readonly laneTriggers: Readonly<Record<number, number>>;
  readonly roundTriggers: Readonly<Record<number, number>>;
  readonly actionTriggers: Readonly<Record<string, number>>;
}

export interface DeployContext { readonly unit: Unit; readonly side: Side; readonly lane: number; readonly round: number; readonly action: number; }
export interface SpellContext { readonly casterId: string; readonly side: Side; readonly isSpell: boolean; readonly round: number; readonly action: number; }
export interface DotContext { readonly targetIds: readonly string[]; readonly targetSide: Side; readonly isDamageOverTime: boolean; readonly round: number; readonly action: number; }

export interface TraitResult {
  readonly state: ProfessionState;
  readonly triggered: boolean;
  readonly effectIds: readonly string[];
  readonly objectIds: readonly string[];
}

export function traitFor(profession: Profession): ProfessionTraitConfig {
  const trait = PROFESSION_TRAITS.find((item) => item.profession === profession);
  if (!trait) throw new Error(`unknown profession: ${profession}`);
  return trait;
}

export function professionEffectFor(effectId: string): ProfessionEffect {
  const effect = PROFESSION_EFFECTS[effectId];
  if (!effect) throw new Error(`unknown profession effect: ${effectId}`);
  return effect;
}

export function createProfessionState(profession: Profession): ProfessionState {
  traitFor(profession);
  return freeze({ profession, logs: [], laneTriggers: {}, roundTriggers: {}, actionTriggers: {} });
}

function append(state: ProfessionState, context: { round: number; action: number }, objectIds: readonly string[]): TraitResult {
  const trait = traitFor(state.profession);
  const log: ProfessionLog = {
    sequence: state.logs.length + 1,
    profession: state.profession,
    traitId: trait.traitId,
    trigger: trait.trigger,
    effectIds: [...trait.effectIds],
    objectIds: [...objectIds],
    round: context.round,
    action: context.action,
  };
  return { state: freeze({ ...state, logs: [...state.logs, log] }), triggered: true, effectIds: freeze([...trait.effectIds]), objectIds: freeze([...objectIds]) };
}

function validContext(round: number, action: number): boolean {
  return Number.isSafeInteger(round) && round >= 1 && Number.isSafeInteger(action) && action >= 1;
}

export function triggerDeploy(state: ProfessionState, context: DeployContext): TraitResult {
  const trait = traitFor(state.profession);
  if (!trait.enabled || trait.trigger !== 'FIRST_DEPLOY_PER_LANE' || context.side !== 'player' || context.unit.side !== context.side || !validContext(context.round, context.action) || !Number.isSafeInteger(context.lane) || context.lane < 0 || context.lane > 1) return noTrigger(state);
  if ((state.laneTriggers[context.lane] ?? 0) >= (trait.perLaneLimit ?? 1)) return noTrigger(state);
  return append({ ...state, laneTriggers: { ...state.laneTriggers, [context.lane]: (state.laneTriggers[context.lane] ?? 0) + 1 } }, context, [context.unit.id]);
}

export function triggerSpell(state: ProfessionState, context: SpellContext): TraitResult {
  const trait = traitFor(state.profession);
  if (!trait.enabled || trait.trigger !== 'FIRST_SPELL_PER_ACTION' || context.side !== 'player' || !context.isSpell || !validContext(context.round, context.action) || !context.casterId) return noTrigger(state);
  const actionKey = `${context.round}:${context.action}`;
  if ((state.actionTriggers[actionKey] ?? 0) >= (trait.perActionLimit ?? 1)) return noTrigger(state);
  return append({ ...state, actionTriggers: { ...state.actionTriggers, [actionKey]: (state.actionTriggers[actionKey] ?? 0) + 1 } }, context, [context.casterId]);
}

export function triggerDamageOverTime(state: ProfessionState, context: DotContext): TraitResult {
  const trait = traitFor(state.profession);
  if (!trait.enabled || trait.trigger !== 'FIRST_DOT_PER_ROUND' || context.targetSide !== 'player' || !context.isDamageOverTime || !validContext(context.round, context.action) || context.targetIds.length === 0 || context.targetIds.some((id) => !id)) return noTrigger(state);
  if ((state.roundTriggers[context.round] ?? 0) >= (trait.perRoundLimit ?? 1)) return noTrigger(state);
  return append({ ...state, roundTriggers: { ...state.roundTriggers, [context.round]: (state.roundTriggers[context.round] ?? 0) + 1 } }, context, context.targetIds);
}

export function triggerBattleStart(state: ProfessionState, hand: readonly CardInstance[], round = 1): TraitResult {
  const trait = traitFor(state.profession);
  if (!trait.enabled || trait.trigger !== 'BATTLE_START' || state.logs.length > 0 || !Number.isSafeInteger(round) || round < 1) return noTrigger(state);
  const candidates = hand.filter((card) => /^U\d{3}$/.test(card.cardId) && Number.isSafeInteger(card.remainingPreparation) && card.remainingPreparation >= 0).slice().sort((a, b) => b.remainingPreparation - a.remainingPreparation || a.instanceId.localeCompare(b.instanceId));
  if (candidates.length === 0) return noTrigger(state);
  const target = candidates[0];
  const result = append(state, { round, action: 0 }, [target.instanceId]);
  return { ...result, state: freeze(result.state) };
}

function noTrigger(state: ProfessionState): TraitResult {
  return { state, triggered: false, effectIds: freeze([]), objectIds: freeze([]) };
}

export function validateProfessionTraits(): void {
  const seen = new Set<Profession>();
  for (const trait of PROFESSION_TRAITS) {
    if (seen.has(trait.profession)) throw new Error(`duplicate profession: ${trait.profession}`);
    seen.add(trait.profession);
    if (!trait.traitId || trait.effectIds.length === 0 || !trait.enabled) throw new Error(`invalid profession trait: ${trait.profession}`);
    for (const effectId of trait.effectIds) professionEffectFor(effectId);
    for (const limit of [trait.perLaneLimit, trait.perRoundLimit, trait.perActionLimit]) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error(`invalid profession limit: ${trait.profession}`);
    }
  }
  if (seen.size !== 4) throw new Error('four profession traits are required');
}

validateProfessionTraits();
