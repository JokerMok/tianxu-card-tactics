import { createBoardState } from '../board/index.ts';
import { createAiState, decideAiAction, setAiEnabled } from './index.ts';
import type { CardInstance } from '../cards/index.ts';

const card = (instanceId: string, cardId: string, remainingPreparation = 0): CardInstance => ({ instanceId, cardId, remainingPreparation });
const enemy = { id: 'enemy-1', cardId: 'U013', name: 'enemy', side: 'enemy' as const, lane: 0, cell: 9, hp: 10, maxHp: 10, attack: 2, armor: 0, move: 1, range: 1, role: 'guard' as const, tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };

export function runAiValidation(): void {
  const board = createBoardState();
  const base = createAiState(7);
  const deployment = decideAiAction(base, { board, hand: [card('s1', 'S001'), card('u1', 'U013')] });
  if (deployment.action.type !== 'DEPLOY_UNIT' || deployment.action.cardInstanceId !== 'u1') throw new Error('AI must prioritize a ready unit');
  if (deployment.action.lane !== 0 || deployment.action.cell !== 9) throw new Error('AI deployment cell is not deterministic/legal');
  const ranged = decideAiAction(base, { board, hand: [card('u2', 'U014')], unitProfileByCardId: () => ({ lane: 0, role: 'support', tags: ['ranged'] }) });
  if (ranged.action.type !== 'DEPLOY_UNIT' || ranged.action.cell !== 11) throw new Error('AI ranged deployment profile mismatch');
  const highPressureBoard = createBoardState([{ ...enemy, id: 'pressure', side: 'player', lane: 1, cell: 10 }]);
  const pressured = decideAiAction(base, { board: highPressureBoard, hand: [card('u3', 'U013')], unitProfileByCardId: () => ({ lane: 0, role: 'guard', tags: [] }) });
  if (pressured.action.type !== 'DEPLOY_UNIT' || pressured.action.lane !== 1) throw new Error('AI ignored high-pressure lane');
  const skill = decideAiAction(base, { board: createBoardState([enemy]), hand: [card('s1', 'S001')], canUseSkill: () => true, skillTargets: () => ['enemy-1'] });
  if (skill.action.type !== 'CAST_SKILL' || skill.action.targetIds?.[0] !== 'enemy-1') throw new Error('AI skill policy mismatch');
  const invalidSkill = decideAiAction(base, { board, hand: [card('s1', 'S001')], canUseSkill: () => true, skillTargets: () => ['missing'] });
  if (invalidSkill.action.type !== 'END_TURN') throw new Error('AI accepted an invalid skill target');
  const disabled = decideAiAction(setAiEnabled(base, false), { board, hand: [card('u1', 'U013')] });
  if (disabled.action.type !== 'NOOP' || disabled.state.actionCount !== 0) throw new Error('AI takeover did not stop');
  const second = decideAiAction(base, { board, hand: [card('u1', 'U013')] });
  if (JSON.stringify(deployment.action) !== JSON.stringify(second.action)) throw new Error('AI decision is not deterministic');
}

runAiValidation();
