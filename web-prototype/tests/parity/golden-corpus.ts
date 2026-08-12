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

export const fixture = validateParityFixture(fixtureInput);
const runnerPath = path.resolve(process.cwd(), '../cocos-client/assets/scripts/battle/runner/battle-runner.ts');

export function runCocos(seed: number, inputFixture = fixture): { output: Record<string, any>; status: number | null; bytes: string } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
    input: JSON.stringify({ protocol: 'tianxu.cocos-battle-runner/v2', seed, fixture: inputFixture }),
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  if (result.error) throw result.error;
  return { output: JSON.parse(result.stdout), status: result.status, bytes: result.stdout };
}

export function withActions(actions: readonly unknown[]) {
  return validateParityFixture({ ...fixture, actions });
}

export function compare(seed: number, inputFixture = fixture): {
  react: Record<string, any>;
  cocos: Record<string, any>;
  cocosOutput: Record<string, any>;
  reactRun: ReturnType<typeof runReactParityFixture>;
  reactEvents: Record<string, any>[];
  cocosEvents: Record<string, any>[];
} {
  const reactRun = runReactParityFixture(inputFixture, seed);
  const cocosRun = runCocos(seed, inputFixture);
  if (cocosRun.status !== 0 || cocosRun.output.status !== 'ok') {
    throw new Error(`Cocos runner failed: ${JSON.stringify(cocosRun.output)}`);
  }
  const states = projectParityFinalState(reactRun.rawFinalState, cocosRun.output.finalState, inputFixture, reactRun.unitAliases);
  const reactEvents = projectParityEvents(reactRun.rawEvents, inputFixture, reactRun.unitAliases);
  const cocosEvents = projectCocosParityEvents(cocosRun.output.events, inputFixture);
  return { ...states, cocosOutput: cocosRun.output, reactRun, reactEvents, cocosEvents };
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
const safeUnitRefs = new Set(['c-U001', 'c-U002', 'c-U004']);
const unitStats: Record<string, { attack: number; armor: number; range: number; hp: number }> = {
  U001: { attack: 2, armor: 2, range: 1, hp: 8 },
  U002: { attack: 3, armor: 1, range: 1, hp: 5 },
  U004: { attack: 3, armor: 0, range: 3, hp: 4 },
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
    let target = simTarget(units, unit);
    if (!target) {
      const direction = side === 'player' ? 1 : -1;
      const nextCell = unit.cell + direction;
      if (nextCell >= 0 && nextCell < 12 && !units.some((other) => other.hp > 0 && other.lane === unit.lane && other.cell === nextCell)) unit.cell = nextCell;
      target = simTarget(units, unit);
    }
    if (target) target.hp = Math.max(0, target.hp - Math.max(1, unitStats[unit.cardId].attack - unitStats[target.cardId].armor));
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

export function buildDeterministicActions(seed: number): unknown[] {
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
  const units: SimUnit[] = [];
  const laneBySide: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  for (let guard = 0; guard < 160; guard += 1) {
    const ready = hands[active].filter((card) => card.remaining === 0 && safeUnitRefs.has(`c-${card.id}`));
    if (deployed[active].length < 2 && ready.length >= 2) {
      const side = active;
      if (deployed[side].length === 0) {
        const freePrimary = [0, 1, 2].filter((cell) => !units.some((unit) => unit.hp > 0 && unit.lane === 0 && unit.cell === cell));
        if (freePrimary.length < 2) laneBySide[side] = 1;
      }
      const cells = (side === 'player' ? [0, 1, 2] : [11, 10, 9]).filter((cell) => !units.some((unit) => unit.hp > 0 && unit.lane === laneBySide[side] && unit.cell === cell));
      if (cells.length < 2) break;
      for (let index = 0; index < 2; index += 1) {
        const card = ready[index];
        const cardRef = `c-${card.id}`;
        const unitRef = `${side === 'player' ? 'p' : 'e'}${index + 1}`;
        actions.push({ type: 'DEPLOY_UNIT', cardRef, unitRef, side, lane: laneBySide[side], cell: cells[index] });
        units.push({ ref: unitRef, side, lane: laneBySide[side], cell: cells[index], hp: unitStats[card.id].hp, cardId: card.id });
        deployed[side].push(unitRef);
        hands[side].splice(hands[side].indexOf(card), 1);
      }
      if (deployed.player.length === 2 && deployed.enemy.length === 2) break;
      continue;
    }
    actions.push({ type: 'END_TURN' });
    simulateAutoTurn(units, active);
    for (const card of hands[active]) if (card.remaining === 0) card.remaining = Math.floor(cardPrepare[card.id] / 2);
    const drawn = decks[active].shift();
    if (drawn) hands[active].push({ id: drawn, remaining: cardPrepare[drawn] });
    active = active === 'player' ? 'enemy' : 'player';
    for (const card of hands[active]) card.remaining = Math.max(0, card.remaining - 1);
  }
  if (deployed.player.length === 2 && deployed.enemy.length === 2) {
    const first = units.find((unit) => unit.side === active);
    if (first) {
      actions.push({ type: 'MOVE_UNIT', unitRef: first.ref, steps: 2 });
      simExplicitMove(units, first.ref, 2);
    }
    for (let index = 0; index < 20; index += 1) {
      const attacker = units.find((unit) => unit.side === active && unit.hp > 0);
      const target = attacker ? simTarget(units, attacker) : undefined;
      if (attacker && target) {
        actions.push({ type: 'ATTACK', unitRef: attacker.ref });
        target.hp = Math.max(0, target.hp - Math.max(1, unitStats[attacker.cardId].attack - unitStats[target.cardId].armor));
        if (target.hp <= 0) units.splice(units.indexOf(target), 1);
        break;
      }
      actions.push({ type: 'END_TURN' });
      simulateAutoTurn(units, active);
      active = active === 'player' ? 'enemy' : 'player';
    }
  }
  return actions;
}

export function hasAutoAction(events: readonly Record<string, any>[]): boolean {
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== 'TURN_END') continue;
    for (let cursor = index + 1; cursor < events.length && events[cursor].type !== 'TURN_START'; cursor += 1) {
      if (events[cursor].type === 'UNIT_MOVED' || events[cursor].type === 'ATTACK' || events[cursor].type === 'DAMAGE') return true;
    }
  }
  return false;
}

export function heroDeathActions(seed = 42): unknown[] {
  const stream = buildDeterministicActions(seed);
  let enemyDeployments = 0;
  let end = stream.length;
  for (let index = 0; index < stream.length; index += 1) {
    const action = stream[index] as { type?: string; side?: string };
    if (action.type === 'DEPLOY_UNIT' && action.side === 'enemy') enemyDeployments += 1;
    if (enemyDeployments === 2) {
      end = index + 1;
      break;
    }
  }
  return [...stream.slice(0, end), ...Array.from({ length: 29 }, () => ({ type: 'END_TURN' }))];
}

export function lifecycleCount(events: readonly Record<string, any>[]): number {
  return projectParityLifecycle(events as unknown as Record<string, any>[]).length;
}
