import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  canPlayCard,
  createBattle,
  endTurn,
  getLegalDeploymentCells,
  playCard,
  runEnemyTurn,
  runPlayerAutoAction,
  surrenderBattle,
} from '../src/battle/engine';
import { getCard } from '../src/data/cards';
import { PLAYER_DECK, PLAYER_PROFESSION, getDeckComposition, validateDeck } from '../src/data/decks';
import type { BattleState, Side } from '../src/battle/types';

function setReadyCard(state: BattleState, side: Side, index: number, cardId: string): string {
  state.hands[side][index].cardId = cardId;
  state.hands[side][index].remaining = 0;
  return state.hands[side][index].instanceId;
}

function playerBattle(seed = 100): BattleState {
  const state = createBattle(seed);
  state.activeSide = 'player';
  state.openingInitiative = 'player';
  return state;
}

describe('battle engine', () => {
  it('starts with two 30-card decks, five-card hands, and a seeded first actor', () => {
    const state = createBattle(100);
    expect(state.hands.player).toHaveLength(5);
    expect(state.decks.player).toHaveLength(25);
    expect(state.hands.enemy).toHaveLength(5);
    expect(state.decks.enemy).toHaveLength(25);
    expect(state.activeSide).toBe('player');
    expect(createBattle(101).activeSide).toBe('enemy');
    expect(getDeckComposition(PLAYER_DECK)).toEqual({ units: 27, skills: 3 });
  });

  it('ends the battle once when the player confirms surrender', () => {
    const state = playerBattle();
    const surrendered = surrenderBattle(state, 'player');
    expect(state.status).toBe('playing');
    expect(surrendered.status).toBe('lost');
    expect(surrendered.winner).toBe('enemy');
    expect(surrendered.events.filter((event) => event.type === 'BATTLE_END')).toHaveLength(1);
    expect(surrenderBattle(surrendered, 'player')).toBe(surrendered);
  });

  it('enforces deck size, card copy limits, skill copies, and profession', () => {
    expect(() => validateDeck(PLAYER_DECK, PLAYER_PROFESSION)).not.toThrow();
    expect(() => validateDeck([...PLAYER_DECK, 'U001'], PLAYER_PROFESSION)).toThrow('30 张');

    const tooFewUnits = [...PLAYER_DECK];
    for (const cardId of ['S006', 'S007', 'S009', 'S001']) {
      tooFewUnits[tooFewUnits.findIndex((id) => id.startsWith('U'))] = cardId;
    }
    expect(() => validateDeck(tooFewUnits, PLAYER_PROFESSION)).toThrow('单位卡不得少于 24 张');

    const duplicateSkill = [...PLAYER_DECK];
    duplicateSkill[duplicateSkill.indexOf('U001')] = 'S001';
    expect(() => validateDeck(duplicateSkill, PLAYER_PROFESSION)).toThrow('超过携带上限 1 张');

    const excessiveUnit = [...PLAYER_DECK];
    excessiveUnit[excessiveUnit.indexOf('U006')] = 'U001';
    expect(() => validateDeck(excessiveUnit, PLAYER_PROFESSION)).toThrow('超过携带上限 4 张');

    const wrongProfession = [...PLAYER_DECK];
    wrongProfession[wrongProfession.indexOf('U001')] = 'S006';
    expect(() => validateDeck(wrongProfession, PLAYER_PROFESSION)).toThrow('不属于当前职业');
  });

  it('reduces preparation only when that side starts its own turn', () => {
    let state = playerBattle();
    state.hands.player[0].remaining = 2;
    state.hands.enemy[0].remaining = 2;
    state = endTurn(state, 'player');
    expect(state.activeSide).toBe('enemy');
    expect(state.hands.player[0].remaining).toBe(2);
    expect(state.hands.enemy[0].remaining).toBe(1);
    state = endTurn(state, 'enemy');
    expect(state.activeSide).toBe('player');
    expect(state.hands.player[0].remaining).toBe(1);
  });

  it('allows every ready card to be used during the same action window', () => {
    let state = playerBattle();
    const first = setReadyCard(state, 'player', 0, 'U001');
    const second = setReadyCard(state, 'player', 1, 'U002');
    state = playCard(state, 'player', first, { kind: 'cell', lane: 0, cell: 0 }).state;
    expect(canPlayCard(state, 'player', state.hands.player.find((card) => card.instanceId === second)!)).toBe(true);
    state = playCard(state, 'player', second, { kind: 'cell', lane: 1, cell: 2 }).state;
    expect(state.units.filter((unit) => unit.side === 'player')).toHaveLength(2);
  });

  it('uses player auto-control to deploy ready units and end the action window', () => {
    let state = playerBattle(220);
    setReadyCard(state, 'player', 0, 'U001');
    setReadyCard(state, 'player', 1, 'U004');
    for (let action = 0; action < 8 && state.activeSide === 'player'; action += 1) {
      state = runPlayerAutoAction(state);
    }
    expect(state.activeSide).toBe('enemy');
    expect(state.units.filter((unit) => unit.side === 'player')).toHaveLength(2);
    expect(state.units.every((unit) => unit.cell >= 1 && unit.cell <= 3)).toBe(true);
  });

  it('keeps auto-control skills for lethal or multi-target situations', () => {
    let state = playerBattle(221);
    state.hands.player.forEach((card) => { card.remaining = 99; });
    const unitCard = setReadyCard(state, 'player', 0, 'U001');
    state = playCard(state, 'player', unitCard, { kind: 'cell', lane: 0, cell: 0 }).state;
    state.units[0].side = 'enemy';
    state.units[0].cell = 7;
    setReadyCard(state, 'player', 0, 'S003');
    const held = runPlayerAutoAction(state);
    expect(held.graveyards.player).not.toContain('S003');

    state = playerBattle(222);
    state.hands.player.forEach((card) => { card.remaining = 99; });
    const templateCard = setReadyCard(state, 'player', 0, 'U001');
    state = playCard(state, 'player', templateCard, { kind: 'cell', lane: 0, cell: 0 }).state;
    const source = { ...state.units[0], side: 'enemy' as const, cell: 7, status: { ...state.units[0].status } };
    state.units = [{ ...source, id: 'enemy-a' }, { ...source, id: 'enemy-b', cell: 8, status: { ...source.status } }];
    setReadyCard(state, 'player', 0, 'S003');
    state = runPlayerAutoAction(state);
    expect(state.graveyards.player).toContain('S003');
    expect(state.units.map((unit) => unit.hp)).toEqual([6, 6]);
  });

  it('rejects cards played outside their owner action window', () => {
    const state = playerBattle();
    const enemyCard = setReadyCard(state, 'enemy', 0, 'U001');
    const result = playCard(state, 'enemy', enemyCard, { kind: 'cell', lane: 0, cell: 11 });
    expect(result.played).toBe(false);
    expect(result.reason).toContain('行动回合');
  });

  it('does not mark ready cards playable when no legal target exists', () => {
    let state = playerBattle();
    const card = setReadyCard(state, 'player', 0, 'U001');
    state = playCard(state, 'player', card, { kind: 'cell', lane: 0, cell: 0 }).state;
    const source = state.units[0];
    for (let lane = 0; lane < 2; lane += 1) {
      for (let cell = 0; cell < 3; cell += 1) {
        if (lane === 0 && cell === 0) continue;
        state.units.push({ ...source, id: `occupied-${lane}-${cell}`, lane, cell, status: { ...source.status } });
      }
    }
    const blockedUnit = state.hands.player[0];
    blockedUnit.cardId = 'U002';
    blockedUnit.remaining = 0;
    expect(canPlayCard(state, 'player', blockedUnit)).toBe(false);

    blockedUnit.cardId = 'S001';
    blockedUnit.remaining = 0;
    expect(canPlayCard(state, 'player', blockedUnit)).toBe(false);
  });

  it('restores unused ready cards to half preparation and draws exactly one card', () => {
    let state = playerBattle();
    const instanceId = setReadyCard(state, 'player', 0, 'U008');
    const handBefore = state.hands.player.length;
    const deckBefore = state.decks.player.length;
    state = endTurn(state, 'player');
    const retained = state.hands.player.find((card) => card.instanceId === instanceId)!;
    expect(retained.remaining).toBe(Math.floor(getCard('U008').prepare / 2));
    expect(state.hands.player).toHaveLength(handBefore + 1);
    expect(state.decks.player).toHaveLength(deckBefore - 1);
  });

  it('does not refill immediately after a card is played', () => {
    let state = playerBattle();
    const card = setReadyCard(state, 'player', 0, 'U001');
    const handBefore = state.hands.player.length;
    const deckBefore = state.decks.player.length;
    state = playCard(state, 'player', card, { kind: 'cell', lane: 0, cell: 1 }).state;
    expect(state.hands.player).toHaveLength(handBefore - 1);
    expect(state.decks.player).toHaveLength(deckBefore);
    state = endTurn(state, 'player');
    expect(state.hands.player).toHaveLength(handBefore);
    expect(state.decks.player).toHaveLength(deckBefore - 1);
  });

  it('lets newly deployed units act after their owner ends the turn', () => {
    let state = playerBattle();
    const fast = setReadyCard(state, 'player', 0, 'U005');
    state = playCard(state, 'player', fast, { kind: 'cell', lane: 0, cell: 2 }).state;
    expect(state.units[0].cell).toBe(2);
    state = endTurn(state, 'player');
    expect(state.units[0].cell).toBe(4);
  });

  it('deploys within all six 1v1 summon cells and rejects occupied or out-of-zone cells', () => {
    let state = playerBattle();
    expect(getLegalDeploymentCells(state, 'player')).toEqual([
      { lane: 0, cell: 0 }, { lane: 0, cell: 1 }, { lane: 0, cell: 2 },
      { lane: 1, cell: 0 }, { lane: 1, cell: 1 }, { lane: 1, cell: 2 },
    ]);
    expect(getLegalDeploymentCells(state, 'enemy')).toEqual([
      { lane: 0, cell: 11 }, { lane: 0, cell: 10 }, { lane: 0, cell: 9 },
      { lane: 1, cell: 11 }, { lane: 1, cell: 10 }, { lane: 1, cell: 9 },
    ]);
    const first = setReadyCard(state, 'player', 0, 'U001');
    state = playCard(state, 'player', first, { kind: 'cell', lane: 0, cell: 2 }).state;
    expect(getLegalDeploymentCells(state, 'player')).not.toContainEqual({ lane: 0, cell: 2 });
    const second = setReadyCard(state, 'player', 0, 'U002');
    const occupied = playCard(state, 'player', second, { kind: 'cell', lane: 0, cell: 2 });
    expect(occupied.played).toBe(false);
    const outside = playCard(state, 'player', second, { kind: 'cell', lane: 0, cell: 3 });
    expect(outside.played).toBe(false);
    state = playCard(state, 'player', second, { kind: 'cell', lane: 0, cell: 1 }).state;
    expect(state.units.map((unit) => unit.cell).sort()).toEqual([1, 2]);
  });

  it('moves automatically and stops before an occupied cell', () => {
    let state = playerBattle();
    const fast = setReadyCard(state, 'player', 0, 'U005');
    state = playCard(state, 'player', fast, { kind: 'cell', lane: 1, cell: 0 }).state;
    const blocker = { ...state.units[0], id: 'blocker', cardId: 'U001', name: 'blocker', cell: 2, move: 0 };
    state.units.push(blocker);
    state = endTurn(state, 'player');
    const moved = state.units.find((unit) => unit.id !== 'blocker')!;
    expect(moved.cell).toBe(1);
  });

  it('applies physical armor and anti-fast bonus', () => {
    let state = playerBattle();
    const spear = setReadyCard(state, 'player', 0, 'U002');
    state = playCard(state, 'player', spear, { kind: 'cell', lane: 0, cell: 0 }).state;
    state.units[0].cell = 5;
    state.units.push({
      ...state.units[0],
      id: 'enemy-fast',
      cardId: 'U005',
      name: 'enemy-fast',
      side: 'enemy',
      cell: 6,
      hp: 4,
      maxHp: 4,
      armor: 0,
      tags: ['fast'],
      status: { ...state.units[0].status },
    });
    state = endTurn(state, 'player');
    expect(state.units.find((unit) => unit.id === 'enemy-fast')).toBeUndefined();
  });

  it('casts damage and area skills during the same action window', () => {
    let state = playerBattle();
    const unitCard = setReadyCard(state, 'player', 0, 'U001');
    state = playCard(state, 'player', unitCard, { kind: 'cell', lane: 1, cell: 0 }).state;
    const target = state.units[0];
    target.side = 'enemy';
    target.cell = 7;

    const damageCard = setReadyCard(state, 'player', 0, 'S001');
    state = playCard(state, 'player', damageCard, { kind: 'unit', unitId: target.id }).state;
    expect(state.units[0].status.burnRounds).toBe(2);

    const areaCard = setReadyCard(state, 'player', 0, 'S003');
    state = playCard(state, 'player', areaCard, { kind: 'lane', lane: 1 }).state;
    expect(state.units[0].cell).toBe(8);
  });

  it('lets enemy auto-play every usable ready card before ending its turn', () => {
    let state = createBattle(101);
    state.activeSide = 'player';
    const playerUnit = setReadyCard(state, 'player', 0, 'U001');
    state = playCard(state, 'player', playerUnit, { kind: 'cell', lane: 0, cell: 0 }).state;
    state.activeSide = 'enemy';
    state.hands.enemy = state.hands.enemy.slice(0, 2);
    setReadyCard(state, 'enemy', 0, 'S001');
    setReadyCard(state, 'enemy', 1, 'U005');
    state.decks.enemy = [];
    state = runEnemyTurn(state);
    expect(state.graveyards.enemy).toContain('S001');
    expect(state.graveyards.enemy).toContain('U005');
    expect(state.activeSide).toBe('player');
  });

  it('applies the scout first-action movement bonus only once', () => {
    let state = playerBattle();
    const scout = setReadyCard(state, 'player', 0, 'U006');
    state = playCard(state, 'player', scout, { kind: 'cell', lane: 0, cell: 0 }).state;
    state = endTurn(state, 'player');
    expect(state.units[0].cell).toBe(3);
    state = endTurn(state, 'enemy');
    state = endTurn(state, 'player');
    expect(state.units[0].cell).toBe(5);
  });

  it('caps the raider attack gain after repeated skill damage', () => {
    let state = playerBattle();
    const raiderCard = setReadyCard(state, 'player', 0, 'U011');
    state = playCard(state, 'player', raiderCard, { kind: 'cell', lane: 0, cell: 0 }).state;
    const raider = state.units[0];
    raider.side = 'enemy';
    raider.cell = 6;
    raider.hp = 100;
    raider.maxHp = 100;
    for (let index = 0; index < 4; index += 1) {
      const skill = setReadyCard(state, 'player', 0, 'S001');
      state = playCard(state, 'player', skill, { kind: 'unit', unitId: raider.id }).state;
    }
    const enraged = state.units.find((unit) => unit.id === raider.id)!;
    expect(enraged.attack).toBe(6);
    expect(enraged.enrageGained).toBe(3);
  });

  it('produces identical outcomes for the same seed and no player actions', () => {
    let first = createBattle(20260712);
    let second = createBattle(20260712);
    for (let turn = 0; turn < 20; turn += 1) {
      first = advanceRound(first);
      second = advanceRound(second);
    }
    expect(second).toEqual(first);
  });

  it('finishes seeded battles without invalid positions or duplicate settlement', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      let state = createBattle(seed);
      while (state.status === 'playing') state = advanceRound(state);
      expect(state.round).toBeLessThanOrEqual(80);
      expect(state.heroHp.player).toBeGreaterThanOrEqual(0);
      expect(state.heroHp.enemy).toBeGreaterThanOrEqual(0);
      expect(state.units.every((unit) => unit.cell >= 0 && unit.cell < 12 && unit.hp > 0)).toBe(true);
      expect(state.events.filter((event) => event.type === 'BATTLE_END')).toHaveLength(1);
    }
  });
});
