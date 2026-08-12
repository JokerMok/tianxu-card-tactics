import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fixtureInput from './fixture.json';
import {
  projectCocosParityEvents,
  projectParityEvents,
  projectParityFinalState,
  projectParityLifecycle,
  runReactParityFixture,
  validateParityFixture,
} from '../../src/battle/parity';

declare const process: any;

const fixture = validateParityFixture(fixtureInput);
const runnerPath = path.resolve(process.cwd(), '../cocos-client/assets/scripts/battle/runner/battle-runner.ts');

function runCocos(seed: number, inputFixture = fixture): { output: Record<string, unknown>; status: number | null } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
    input: JSON.stringify({ protocol: 'tianxu.cocos-battle-runner/v2', seed, fixture: inputFixture }),
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return { output: JSON.parse(result.stdout), status: result.status };
}

function withActions(actions: unknown[]) {
  return validateParityFixture({ ...fixture, actions });
}

function compare(seed: number, inputFixture = fixture): { react: Record<string, unknown>; cocos: Record<string, unknown>; cocosOutput: Record<string, unknown>; reactRun: ReturnType<typeof runReactParityFixture> } {
  const react = runReactParityFixture(inputFixture, seed);
  const cocosOutput = runCocos(seed, inputFixture).output;
  expect(cocosOutput.status, JSON.stringify(cocosOutput)).toBe('ok');
  const states = projectParityFinalState(react.rawFinalState, cocosOutput.finalState, inputFixture, react.unitAliases);
  return { ...states, cocosOutput, reactRun: react };
}

function nextRandom(value: number): { value: number; state: number } {
  let state = value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return { value: (state >>> 0) / 4294967296, state: state | 0 };
}

function shuffle(values: string[], seed: number): { values: string[]; seed: number } {
  const result = [...values];
  let state = seed;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.state;
    const swapIndex = Math.floor(random.value * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return { values: result, seed: state };
}

const cardPrepare: Record<string, number> = { U001: 3, U002: 2, U003: 4, U004: 3, U005: 2, U006: 1, U007: 2, U008: 5, U011: 3, U012: 4, S001: 4, S002: 5, S003: 4 };
const unitRefs = new Set(['c-U001', 'c-U002', 'c-U003', 'c-U004', 'c-U005', 'c-U006', 'c-U007', 'c-U008', 'c-U011', 'c-U012']);
const safeUnitRefs = new Set(['c-U001', 'c-U002', 'c-U004']);
const unitStats: Record<string, { attack: number; armor: number; move: number; range: number; hp: number }> = {
  U001: { attack: 2, armor: 2, move: 1, range: 1, hp: 8 },
  U002: { attack: 3, armor: 1, move: 1, range: 1, hp: 5 },
  U004: { attack: 3, armor: 0, move: 1, range: 3, hp: 4 },
};

type SimUnit = { ref: string; side: 'player' | 'enemy'; lane: number; cell: number; hp: number; cardId: string };

function simTarget(units: SimUnit[], attacker: SimUnit): SimUnit | undefined {
  const distance = (target: SimUnit) => attacker.side === 'player' ? target.cell - attacker.cell : attacker.cell - target.cell;
  return units
    .filter((target) => target.side !== attacker.side && target.lane === attacker.lane && target.hp > 0 && distance(target) > 0 && distance(target) <= unitStats[attacker.cardId].range)
    .sort((a, b) => distance(a) - distance(b) || a.hp - b.hp || a.ref.localeCompare(b.ref))[0];
}

function simulateAutoTurn(units: SimUnit[], side: 'player' | 'enemy'): void {
  const ordered = units.filter((unit) => unit.side === side && unit.hp > 0).sort((a, b) => a.lane - b.lane || (side === 'player' ? -1 : 1) * (a.cell - b.cell) || a.ref.localeCompare(b.ref));
  for (const unit of ordered) {
    if (unit.hp <= 0) continue;
    const stats = unitStats[unit.cardId];
    let target = simTarget(units, unit);
    if (!target) {
      const direction = side === 'player' ? 1 : -1;
      const nextCell = unit.cell + direction;
      if (nextCell >= 0 && nextCell < 12 && !units.some((other) => other.hp > 0 && other.lane === unit.lane && other.cell === nextCell)) unit.cell = nextCell;
      target = simTarget(units, unit);
    }
    if (target) {
      target.hp = Math.max(0, target.hp - Math.max(1, stats.attack - unitStats[target.cardId].armor));
    }
  }
  for (let index = units.length - 1; index >= 0; index -= 1) if (units[index].hp <= 0) units.splice(index, 1);
}

function simExplicitMove(units: SimUnit[], ref: string, steps: number): void {
  const unit = units.find((candidate) => candidate.ref === ref);
  if (!unit) return;
  const direction = unit.side === 'player' ? 1 : -1;
  for (let index = 0; index < steps; index += 1) {
    const nextCell = unit.cell + direction;
    if (nextCell < 0 || nextCell >= 12 || units.some((other) => other !== unit && other.hp > 0 && other.lane === unit.lane && other.cell === nextCell)) break;
    unit.cell = nextCell;
  }
}

function hasAutoAction(events: Array<{ type: string }>): boolean {
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== 'TURN_END') continue;
    for (let cursor = index + 1; cursor < events.length && events[cursor].type !== 'TURN_START'; cursor += 1) {
      if (events[cursor].type === 'UNIT_MOVED' || events[cursor].type === 'ATTACK' || events[cursor].type === 'DAMAGE') return true;
    }
  }
  return false;
}

function buildDeterministicActions(seed: number): unknown[] {
  const deck = fixture.decks.player.map((ref) => fixture.cards.find((card) => card.fixtureCardId === ref)!.reactCardId);
  const shuffledPlayer = shuffle(deck, seed);
  const shuffledEnemy = shuffle(deck, shuffledPlayer.seed);
  const hands: Record<'player' | 'enemy', Array<{ id: string; remaining: number }>> = {
    player: shuffledPlayer.values.slice(0, 5).map((id) => ({ id, remaining: cardPrepare[id] })),
    enemy: shuffledEnemy.values.slice(0, 5).map((id) => ({ id, remaining: cardPrepare[id] })),
  };
  const decks: Record<'player' | 'enemy', string[]> = {
    player: shuffledPlayer.values.slice(5),
    enemy: shuffledEnemy.values.slice(5),
  };
  let active: 'player' | 'enemy' = seed % 2 === 0 ? 'player' : 'enemy';
  for (const card of hands[active]) card.remaining = Math.max(0, card.remaining - 1);
  const actions: unknown[] = [{ type: 'BATTLE_START' }];
  const deployed: Record<'player' | 'enemy', string[]> = { player: [], enemy: [] };
  const simUnits: SimUnit[] = [];
  const laneBySide: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  for (let guard = 0; guard < 160; guard += 1) {
    const ready = hands[active].filter((card) => card.remaining === 0 && unitRefs.has(`c-${card.id}`) && safeUnitRefs.has(`c-${card.id}`));
    if (deployed[active].length < 2 && ready.length >= 2) {
      const side = active;
      if (deployed[side].length === 0) {
        const freeOnPrimary = [0, 1, 2].filter((cell) => !simUnits.some((unit) => unit.hp > 0 && unit.lane === 0 && unit.cell === cell));
        if (freeOnPrimary.length < 2) laneBySide[side] = 1;
      }
      const summonCells = side === 'player' ? [0, 1, 2] : [11, 10, 9];
      const freeCells = summonCells.filter((cell) => !simUnits.some((unit) => unit.hp > 0 && unit.lane === laneBySide[side] && unit.cell === cell));
      if (freeCells.length < 2) break;
      for (let index = 0; index < 2; index += 1) {
        const cardRef = `c-${ready[index].id}`;
        const unitRef = `${side === 'player' ? 'p' : 'e'}${index + 1}`;
        deployed[side].push(unitRef);
        actions.push({ type: 'DEPLOY_UNIT', cardRef, unitRef, side, lane: laneBySide[side], cell: freeCells[index] });
        simUnits.push({ ref: unitRef, side, lane: laneBySide[side], cell: freeCells[index], hp: unitStats[ready[index].id].hp, cardId: ready[index].id });
        const cardIndex = hands[side].findIndex((card) => card === ready[index]);
        hands[side].splice(cardIndex, 1);
      }
      if (deployed.player.length === 2 && deployed.enemy.length === 2) break;
      continue;
    }
    actions.push({ type: 'END_TURN' });
    simulateAutoTurn(simUnits, active);
    for (const card of hands[active]) if (card.remaining === 0) card.remaining = Math.floor(cardPrepare[card.id] / 2);
    const drawn = decks[active].shift();
    if (drawn) hands[active].push({ id: drawn, remaining: cardPrepare[drawn] });
    active = active === 'player' ? 'enemy' : 'player';
    for (const card of hands[active]) card.remaining = Math.max(0, card.remaining - 1);
  }
  if (deployed.player.length === 2 && deployed.enemy.length === 2) {
    const side = active;
    const first = simUnits.find((unit) => unit.side === side);
    if (first) {
      actions.push({ type: 'MOVE_UNIT', unitRef: first.ref, steps: 2 });
      simExplicitMove(simUnits, first.ref, 2);
    }
    for (let index = 0; index < 20; index += 1) {
      const attacker = simUnits.find((unit) => unit.side === active && unit.hp > 0);
      const target = attacker ? simTarget(simUnits, attacker) : undefined;
      if (attacker && target) {
        actions.push({ type: 'ATTACK', unitRef: attacker.ref });
        target.hp = Math.max(0, target.hp - Math.max(1, unitStats[attacker.cardId].attack - unitStats[target.cardId].armor));
        if (target.hp <= 0) simUnits.splice(simUnits.indexOf(target), 1);
        break;
      }
      actions.push({ type: 'END_TURN' });
      simulateAutoTurn(simUnits, active);
      active = active === 'player' ? 'enemy' : 'player';
    }
  }
  return actions;
}

describe('versioned parity contract', () => {
  it('validates explicit mappings and compares empty raw states', () => {
    const result = compare(42, withActions([{ type: 'BATTLE_START' }]));
    expect(result.react).toEqual(result.cocos);
  });

  it('consumes independently generated deployment, blocking movement, attack and auto-turn actions', () => {
    const inputFixture = withActions(buildDeterministicActions(42));
    const result = compare(42, inputFixture);
    expect(result.react).toEqual(result.cocos);
    expect(inputFixture.actions.some((action) => action.type === 'DEPLOY_UNIT')).toBe(true);
    expect(inputFixture.actions.some((action) => action.type === 'MOVE_UNIT')).toBe(true);
    expect(inputFixture.actions.some((action) => action.type === 'END_TURN')).toBe(true);
    const reactEvents = projectParityEvents(result.reactRun.rawEvents, inputFixture, result.reactRun.unitAliases);
    const cocosEvents = projectCocosParityEvents(result.cocosOutput.events as unknown[], inputFixture);
    expect(cocosEvents).toEqual(reactEvents);
    expect(cocosEvents.some((event) => event.type === 'UNIT_MOVED')).toBe(true);
    expect((result.cocosOutput.events as Array<{ type: string; payload?: { blocked?: string } }>).some((event) => event.type === 'UNIT_MOVED' && event.payload?.blocked === 'occupied')).toBe(true);
    expect(hasAutoAction(cocosEvents as Array<{ type: string }>)).toBe(true);
  });

  it('keeps lifecycle boundary deterministic at round 80', () => {
    const inputFixture = withActions(Array.from({ length: 161 }, (_, index) => index === 0 ? { type: 'BATTLE_START' } : { type: 'END_TURN' }));
    const result = compare(42, inputFixture);
    const reactEvents = projectParityEvents(result.reactRun.rawEvents, inputFixture, result.reactRun.unitAliases);
    const cocosEvents = projectCocosParityEvents(result.cocosOutput.events as unknown[], inputFixture);
    expect(projectParityLifecycle(reactEvents)).toHaveLength(1);
    expect(projectParityLifecycle(cocosEvents)).toHaveLength(1);
    expect(result.react).toEqual(result.cocos);
  });

  it('repeats the independent generator across 100 deterministic seeds', { timeout: 60000 }, () => {
    const coverage = new Set<string>();
    const eventCoverage = new Set<string>();
    let automaticCoverage = false;
    let blockedCoverage = false;
    for (let seed = 1; seed <= 100; seed += 1) {
      const inputFixture = withActions(buildDeterministicActions(seed));
      for (const action of inputFixture.actions) coverage.add(action.type);
      let result;
      try {
        result = compare(seed, inputFixture);
      } catch (error) {
        throw new Error(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
      }
      expect(result.react).toEqual(result.cocos);
      const projectedEvents = projectCocosParityEvents(result.cocosOutput.events as unknown[], inputFixture) as Array<{ type: string }>;
      for (const event of projectedEvents) eventCoverage.add(event.type);
      blockedCoverage ||= (result.cocosOutput.events as Array<{ type: string; payload?: { blocked?: string } }>).some((event) => event.type === 'UNIT_MOVED' && event.payload?.blocked === 'occupied');
      automaticCoverage ||= hasAutoAction(projectedEvents);
    }
    expect([...coverage]).toEqual(expect.arrayContaining(['DEPLOY_UNIT', 'MOVE_UNIT', 'ATTACK', 'END_TURN']));
    expect([...eventCoverage]).toEqual(expect.arrayContaining(['UNIT_MOVED', 'ATTACK', 'DAMAGE']));
    expect(blockedCoverage).toBe(true);
    expect(automaticCoverage).toBe(true);
  });
});
