import { describe, expect, it } from 'vitest';
import {
  canPlayCard,
  createBattle,
  endTurn,
  getLegalDeploymentCells,
  getLegalLanes,
  getLegalUnitIds,
  playCard,
  runEnemyTurn,
} from '../src/battle/engine';
import type { BattleState, CardInstance, CardTarget } from '../src/battle/types';
import { getCard } from '../src/data/cards';

type Profile = 'novice' | 'unit-first' | 'balanced' | 'skill-first' | 'rapid';

interface SessionMetrics {
  profile: Profile;
  won: boolean;
  rounds: number;
  unitsPlayed: number;
  skillsPlayed: number;
  rejectedActions: number;
  readyIdleRounds: number;
  blockedReadyRounds: number;
}

const profiles: Profile[] = ['novice', 'unit-first', 'balanced', 'skill-first', 'rapid'];

function createAgentRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function orderedReadyCards(state: BattleState, profile: Profile, random: () => number): CardInstance[] {
  const ready = state.hands.player.filter((card) => card.remaining === 0);
  if (profile === 'unit-first') {
    return ready.sort((a, b) => Number(getCard(b.cardId).kind === 'unit') - Number(getCard(a.cardId).kind === 'unit'));
  }
  if (profile === 'skill-first') {
    return ready.sort((a, b) => Number(getCard(b.cardId).kind === 'skill') - Number(getCard(a.cardId).kind === 'skill'));
  }
  if (profile === 'balanced') {
    return ready.sort((a, b) => {
      const priority = (card: CardInstance) => {
        const definition = getCard(card.cardId);
        if (definition.kind === 'unit') return 2;
        if (definition.skill?.targetType === 'enemy-unit') {
          const lethal = getLegalUnitIds(state, 'player', card.cardId)
            .map((id) => state.units.find((unit) => unit.id === id)!)
            .some((unit) => unit.hp <= (definition.skill?.damage ?? 0));
          return lethal ? 4 : 1;
        }
        const valuableLane = getLegalLanes(state, 'player', card.cardId)
          .some((lane) => state.units.filter((unit) => unit.side === 'enemy' && unit.lane === lane).length >= 2);
        return valuableLane ? 4 : 1;
      };
      const aPriority = priority(a);
      const bPriority = priority(b);
      return bPriority - aPriority || a.remaining - b.remaining;
    });
  }
  if (profile === 'rapid') {
    for (let index = ready.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [ready[index], ready[swapIndex]] = [ready[swapIndex], ready[index]];
    }
    return ready;
  }
  return ready;
}

function chooseLane(state: BattleState, legal: number[], profile: Profile, random: () => number): number {
  if (profile === 'novice' || profile === 'rapid') return legal[Math.floor(random() * legal.length)];
  return [...legal].sort((a, b) => {
    const laneScore = (lane: number) => {
      const allies = state.units.filter((unit) => unit.side === 'player' && unit.lane === lane);
      const enemies = state.units.filter((unit) => unit.side === 'enemy' && unit.lane === lane);
      const enemyThreat = enemies.reduce((sum, unit) => sum + unit.attack + unit.hp, 0);
      const allyPower = allies.reduce((sum, unit) => sum + unit.attack + unit.hp, 0);
      return profile === 'unit-first' || profile === 'balanced'
        ? enemyThreat - allyPower
        : enemyThreat + allies.length * 2;
    };
    return laneScore(b) - laneScore(a) || a - b;
  })[0];
}

function chooseTarget(
  state: BattleState,
  card: CardInstance,
  profile: Profile,
  random: () => number,
): CardTarget | undefined {
  const definition = getCard(card.cardId);
  if (definition.kind === 'unit') {
    const legalCells = getLegalDeploymentCells(state, 'player');
    if (legalCells.length === 0) return undefined;
    if (profile === 'novice' || profile === 'rapid') {
      const target = legalCells[Math.floor(random() * legalCells.length)];
      return { kind: 'cell', ...target };
    }
    const legalLanes = [...new Set(legalCells.map((target) => target.lane))];
    const lane = chooseLane(state, legalLanes, profile, random);
    const role = definition.unit!.role;
    const preferred = legalCells
      .filter((target) => target.lane === lane)
      .sort((a, b) => role === 'ranged' || role === 'healer' ? a.cell - b.cell : b.cell - a.cell)[0];
    return { kind: 'cell', ...preferred };
  }
  if (definition.skill?.targetType === 'lane') {
    const legal = getLegalLanes(state, 'player', card.cardId);
    return legal.length > 0 ? { kind: 'lane', lane: chooseLane(state, legal, profile, random) } : undefined;
  }
  if (definition.skill?.targetType === 'enemy-unit' || definition.skill?.targetType === 'ally-unit') {
    const legal = getLegalUnitIds(state, 'player', card.cardId);
    if (legal.length === 0) return undefined;
    const units = legal
      .map((id) => state.units.find((unit) => unit.id === id)!)
      .sort((a, b) => a.hp - b.hp || b.attack - a.attack || a.id.localeCompare(b.id));
    const target = profile === 'rapid' ? units[Math.floor(random() * units.length)] : units[0];
    return { kind: 'unit', unitId: target.id };
  }
  if (definition.skill?.targetType === 'global') return { kind: 'global' };
  return undefined;
}

function simulateSession(profile: Profile, index: number): SessionMetrics {
  let state = createBattle(10000 + index + profiles.indexOf(profile) * 100);
  const random = createAgentRandom(90000 + index * 17 + profiles.indexOf(profile));
  const metrics: SessionMetrics = {
    profile,
    won: false,
    rounds: 0,
    unitsPlayed: 0,
    skillsPlayed: 0,
    rejectedActions: 0,
    readyIdleRounds: 0,
    blockedReadyRounds: 0,
  };

  while (state.status === 'playing') {
    if (state.activeSide === 'enemy') {
      state = runEnemyTurn(state);
      continue;
    }

    const ready = orderedReadyCards(state, profile, random);
    const actionChance = profile === 'novice' ? 0.72 : profile === 'skill-first' ? 0.85 : 0.92;
    const actionLimit = profile === 'rapid' ? 3 : profile === 'novice' || profile === 'skill-first' ? 1 : 2;
    let playedThisRound = 0;
    let hadLegalTarget = false;

    if (ready.length > 0 && random() <= actionChance) {
      for (const card of ready) {
        if (playedThisRound >= actionLimit || state.status !== 'playing') break;
        const current = state.hands.player.find((item) => item.instanceId === card.instanceId);
        if (!current || current.remaining > 0) continue;
        if (profile !== 'rapid' && !canPlayCard(state, 'player', current)) continue;

        if (profile === 'rapid' && random() < 0.2) {
          const rejected = playCard(state, 'player', current.instanceId, { kind: 'cell', lane: 9, cell: 9 });
          state = rejected.state;
          if (!rejected.played) metrics.rejectedActions += 1;
        }
        if (!canPlayCard(state, 'player', current)) continue;

        const target = chooseTarget(state, current, profile, random);
        if (!target) continue;
        hadLegalTarget = true;
        const result = playCard(state, 'player', current.instanceId, target);
        state = result.state;
        if (!result.played) {
          metrics.rejectedActions += 1;
          continue;
        }
        playedThisRound += 1;
        if (getCard(current.cardId).kind === 'unit') metrics.unitsPlayed += 1;
        else metrics.skillsPlayed += 1;
      }
    } else {
      hadLegalTarget = ready.some((card) => Boolean(chooseTarget(state, card, profile, random)));
    }

    if (ready.length > 0 && playedThisRound === 0) metrics.readyIdleRounds += 1;
    if (ready.length > 0 && !hadLegalTarget) metrics.blockedReadyRounds += 1;
    state = endTurn(state, 'player');
  }

  metrics.won = state.status === 'won';
  metrics.rounds = state.round;
  expect(state.units.every((unit) => unit.cell >= 0 && unit.cell < 12 && unit.hp > 0)).toBe(true);
  expect(state.events.filter((event) => event.type === 'BATTLE_END')).toHaveLength(1);
  return metrics;
}

function aggregate(sessions: SessionMetrics[]) {
  return profiles.map((profile) => {
    const group = sessions.filter((session) => session.profile === profile);
    const average = (key: keyof SessionMetrics) => (
      group.reduce((sum, session) => sum + Number(session[key]), 0) / group.length
    );
    return {
      profile,
      sessions: group.length,
      winRate: average('won'),
      averageRounds: average('rounds'),
      averageUnits: average('unitsPlayed'),
      averageSkills: average('skillsPlayed'),
      averageRejects: average('rejectedActions'),
      averageReadyIdleRounds: average('readyIdleRounds'),
      averageBlockedRounds: average('blockedReadyRounds'),
    };
  });
}

describe('100 simulated user sessions', () => {
  it('completes five behavior cohorts and reports experience metrics', () => {
    const sessions = profiles.flatMap((profile) => (
      Array.from({ length: 20 }, (_, index) => simulateSession(profile, index))
    ));
    const results = aggregate(sessions);
    console.log(`SIMULATED_USER_RESULTS\n${JSON.stringify(results, null, 2)}`);

    expect(sessions).toHaveLength(100);
    expect(sessions.every((session) => session.rounds <= 80)).toBe(true);
    expect(sessions.every((session) => session.unitsPlayed + session.skillsPlayed > 0)).toBe(true);
    const balanced = results.find((result) => result.profile === 'balanced')!;
    expect(balanced.winRate).toBeGreaterThanOrEqual(0.4);
    expect(balanced.winRate).toBeLessThanOrEqual(0.6);
    expect(results.find((result) => result.profile === 'rapid')!.averageRejects).toBeGreaterThan(0);
  });
});
