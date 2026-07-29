import { createProfessionState, PROFESSION_EFFECTS, PROFESSION_TRAITS, professionEffectFor, triggerBattleStart, triggerDamageOverTime, triggerDeploy, triggerSpell, validateProfessionTraits } from './index.ts';
import type { CardInstance, Unit } from '../types/index.ts';

function unit(id: string, lane: number): Unit {
  return { id, cardId: 'U013', name: id, side: 'player', lane, cell: 0, hp: 10, maxHp: 10, attack: 2, armor: 0, move: 1, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

function card(instanceId: string, remainingPreparation: number, cardId = 'U013'): CardInstance {
  return { instanceId, cardId, remainingPreparation };
}

export function runProfessionValidation(): void {
  validateProfessionTraits();
  if (PROFESSION_TRAITS.length !== 4) throw new Error('profession count mismatch');
  if (Object.keys(PROFESSION_EFFECTS).length !== 4 || !professionEffectFor('E_TRAIT_BARRIER_2')) throw new Error('profession effect definitions missing');
  let commander = createProfessionState('COMMANDER');
  commander = triggerDeploy(commander, { unit: unit('a', 0), side: 'player', lane: 0, round: 1, action: 1 }).state;
  if (triggerDeploy(commander, { unit: unit('b', 0), side: 'player', lane: 0, round: 1, action: 2 }).triggered) throw new Error('commander lane limit mismatch');
  if (commander.logs.length !== 1 || commander.logs[0].objectIds[0] !== 'a') throw new Error('commander target/log mismatch');
  if (!Object.isFrozen(commander) || !Object.isFrozen(commander.logs) || !Object.isFrozen(commander.logs[0])) throw new Error('profession state is mutable');
  if (triggerDeploy(commander, { unit: unit('bad', 2), side: 'player', lane: 2, round: 1, action: 3 }).triggered) throw new Error('commander boundary validation missing');
  const arcanistOnce = triggerSpell(createProfessionState('ARCANIST'), { casterId: 'caster', side: 'player', isSpell: true, round: 1, action: 1 });
  const arcanistTwice = triggerSpell(arcanistOnce.state, { casterId: 'caster', side: 'player', isSpell: true, round: 1, action: 1 });
  const arcanistNextRound = triggerSpell(arcanistTwice.state, { casterId: 'caster', side: 'player', isSpell: true, round: 2, action: 1 });
  if (!arcanistOnce.triggered || arcanistTwice.triggered || !arcanistNextRound.triggered) throw new Error('arcanist action limit mismatch');
  const covenantOnce = triggerDamageOverTime(createProfessionState('COVENANT'), { targetIds: ['u1'], targetSide: 'player', isDamageOverTime: true, round: 1, action: 1 });
  if (!covenantOnce.triggered || triggerDamageOverTime(covenantOnce.state, { targetIds: ['u2'], targetSide: 'player', isDamageOverTime: true, round: 1, action: 2 }).triggered) throw new Error('covenant round limit mismatch');
  const tactician = triggerBattleStart(createProfessionState('TACTICIAN'), [card('i2', 4), card('i1', 4), card('i3', 2)]);
  if (!tactician.triggered || tactician.objectIds[0] !== 'i1') throw new Error('tactician tie-break mismatch');
  if (triggerBattleStart(createProfessionState('TACTICIAN'), [card('skill', 99, 'S001')]).triggered) throw new Error('tactician selected non-unit card');
}

runProfessionValidation();
