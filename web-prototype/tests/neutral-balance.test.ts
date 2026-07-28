import { describe, expect, it } from 'vitest';
import {
  canPlayCard,
  createBattle,
  endTurn,
  getLegalDeploymentCells,
  getLegalLanes,
  getLegalUnitIds,
  playCard,
} from '../src/battle/engine';
import { nextRandom } from '../src/battle/rng';
import type { BattleState, CardInstance, CardTarget, Side } from '../src/battle/types';
import { getCard } from '../src/data/cards';

function pick<T>(state: BattleState, values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(nextRandom(state) * values.length)];
}

function randomTarget(state: BattleState, side: Side, card: CardInstance): CardTarget | undefined {
  const definition = getCard(card.cardId);
  if (definition.kind === 'unit') {
    const target = pick(state, getLegalDeploymentCells(state, side));
    return target ? { kind: 'cell', ...target } : undefined;
  }
  if (definition.skill?.targetType === 'lane') {
    const lane = pick(state, getLegalLanes(state, side, card.cardId));
    return lane === undefined ? undefined : { kind: 'lane', lane };
  }
  if (definition.skill?.targetType === 'enemy-unit' || definition.skill?.targetType === 'ally-unit') {
    const unitId = pick(state, getLegalUnitIds(state, side, card.cardId));
    return unitId ? { kind: 'unit', unitId } : undefined;
  }
  if (definition.skill?.targetType === 'global') return { kind: 'global' };
  return undefined;
}

function playNeutralWindow(original: BattleState, side: Side): BattleState {
  let state = original;
  const safetyLimit = state.hands[side].length + 1;
  for (let index = 0; index < safetyLimit && state.status === 'playing'; index += 1) {
    const candidates = state.hands[side].filter((card) => canPlayCard(state, side, card));
    const card = pick(state, candidates);
    if (!card) break;
    const target = randomTarget(state, side, card);
    if (!target) break;
    const result = playCard(state, side, card.instanceId, target);
    if (!result.played) break;
    state = result.state;
  }
  return state;
}

function simulateNeutralBattle(seed: number): BattleState {
  let state = createBattle(seed);
  while (state.status === 'playing') {
    const side = state.activeSide;
    state = playNeutralWindow(state, side);
    state = endTurn(state, side);
  }
  return state;
}

describe('neutral numerical balance', () => {
  it('keeps the original-style no-tactics win rate centered on 50 percent', () => {
    const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const battles = Number(environment?.BALANCE_BATTLES ?? 1000);
    const seedOffset = Number(environment?.BALANCE_SEED_OFFSET ?? 300000);
    let playerWins = 0;
    let totalRounds = 0;
    for (let index = 1; index <= battles; index += 1) {
      const state = simulateNeutralBattle(seedOffset + index);
      if (state.winner === 'player') playerWins += 1;
      totalRounds += state.round;
      expect(state.round).toBeLessThanOrEqual(80);
    }

    const winRate = playerWins / battles;
    const standardError = Math.sqrt(winRate * (1 - winRate) / battles);
    console.log(`NEUTRAL_BALANCE_RESULTS\n${JSON.stringify({
      battles,
      seedOffset,
      playerWins,
      enemyWins: battles - playerWins,
      winRate,
      averageRounds: totalRounds / battles,
      confidence95: [winRate - 1.96 * standardError, winRate + 1.96 * standardError],
    }, null, 2)}`);

    const tolerance = battles >= 10000 ? 0.01 : 0.05;
    expect(winRate).toBeGreaterThanOrEqual(0.5 - tolerance);
    expect(winRate).toBeLessThanOrEqual(0.5 + tolerance);
  }, 300000);
});
