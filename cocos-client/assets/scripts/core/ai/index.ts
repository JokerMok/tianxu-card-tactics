import { getLegalDeploymentCells, type BoardState } from '../board/index.ts';
import type { CardInstance } from '../cards/index.ts';
import { chooseSeeded, type RngState } from '../rng/index.ts';
import type { Unit } from '../types/index.ts';

export type AiActionType = 'DEPLOY_UNIT' | 'CAST_SKILL' | 'END_TURN' | 'NOOP';

export type AiAction =
  | { readonly type: 'DEPLOY_UNIT'; readonly cardInstanceId: string; readonly lane: number; readonly cell: number }
  | { readonly type: 'CAST_SKILL'; readonly cardInstanceId: string; readonly targetIds: readonly string[] }
  | { readonly type: 'END_TURN' }
  | { readonly type: 'NOOP' };

export interface AiState {
  readonly enabled: boolean;
  readonly rng: RngState;
  readonly actionCount: number;
}

export interface AiDecisionContext {
  readonly board: BoardState;
  readonly hand: readonly CardInstance[];
  readonly enemyUnits?: readonly Unit[];
  readonly canUseSkill?: (card: CardInstance, board: BoardState) => boolean;
  readonly skillTargets?: (card: CardInstance, board: BoardState) => readonly string[];
  readonly unitProfileByCardId?: (cardId: string) => Pick<Unit, 'role' | 'tags' | 'lane'> | undefined;
}

export function createAiState(seed: number, enabled = true): AiState {
  return { enabled, rng: { rngState: seed || 1, rngCursor: 0 }, actionCount: 0 };
}

export function setAiEnabled(state: AiState, enabled: boolean): AiState {
  return { ...state, enabled };
}

export function chooseDeploymentCell(board: BoardState, unit: Unit): { lane: number; cell: number } | undefined {
  const cells = getLegalDeploymentCells(board, 'enemy');
  const laneCells = cells.filter((cell) => cell.lane === unit.lane);
  const candidates = laneCells.length > 0 ? laneCells : cells;
  if (candidates.length === 0) return undefined;
  const nearHero = unit.role === 'support' || unit.tags.includes('ranged') || unit.tags.includes('healer');
  return [...candidates].sort((a, b) => nearHero ? b.cell - a.cell || a.lane - b.lane : a.cell - b.cell || a.lane - b.lane)[0];
}

function unitCard(card: CardInstance): boolean { return /^U\d{3}$/.test(card.cardId); }

function ready(card: CardInstance): boolean { return card.remainingPreparation <= 0; }

function pressure(board: BoardState, lane: number): number {
  return board.units.filter((unit) => unit.lane === lane && unit.hp > 0).reduce((total, unit) => {
    const progressToEnemyHero = unit.side === 'player' ? unit.cell : 11 - unit.cell;
    const distanceWeight = Math.max(0, Math.min(11, progressToEnemyHero)) / 11;
    return total + 1 + unit.attack + unit.hp / Math.max(1, unit.maxHp) + distanceWeight;
  }, 0);
}

export function decideAiAction(state: AiState, context: AiDecisionContext): { action: AiAction; state: AiState } {
  if (!state.enabled) return { action: { type: 'NOOP' }, state };
  const readyCards = context.hand.filter(ready);
  const units = readyCards.filter(unitCard);
  if (units.length > 0) {
    const ranked = [...units].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    const selection = chooseSeeded(state.rng, ranked);
    const card = selection.value ?? ranked[0];
    const lane = pressure(context.board, 1) > pressure(context.board, 0) ? 1 : 0;
    const profile = context.unitProfileByCardId?.(card.cardId) ?? { lane, role: 'guard' as const, tags: [] as readonly string[] };
    const unit = { lane, role: profile.role, tags: profile.tags, side: 'enemy' as const } as Unit;
    const cell = chooseDeploymentCell(context.board, unit);
    if (cell) return next({ ...state, rng: selection.state }, { type: 'DEPLOY_UNIT', cardInstanceId: card.instanceId, ...cell });
  }
  const skill = readyCards.find((card) => !unitCard(card) && (context.canUseSkill?.(card, context.board) ?? false));
  if (skill) {
    const targets = (context.skillTargets?.(skill, context.board) ?? [])
      .filter((id) => context.board.units.some((unit) => unit.id === id && unit.hp > 0));
    if (targets.length > 0) return next(state, { type: 'CAST_SKILL', cardInstanceId: skill.instanceId, targetIds: [...targets] });
  }
  return next(state, { type: 'END_TURN' });
}

function next(state: AiState, action: AiAction): { action: AiAction; state: AiState } {
  return { action, state: { ...state, actionCount: state.actionCount + 1 } };
}

export function chooseSeededAction<T>(rng: RngState, values: readonly T[]): { value: T | undefined; rng: RngState } {
  const result = chooseSeeded(rng, values);
  return { value: result.value, rng: result.state };
}
