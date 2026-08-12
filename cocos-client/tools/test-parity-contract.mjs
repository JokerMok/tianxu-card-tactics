import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(root, 'assets/scripts/battle/runner/battle-runner.ts');
const fixturePath = path.resolve(root, '../web-prototype/tests/parity/fixture.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const protocol = 'tianxu.cocos-battle-runner/v2';
const prepare = { U001: 3, U002: 2, U003: 4, U004: 3, U005: 2, U006: 1, U007: 2, U008: 5, U011: 3, U012: 4, S001: 4, S002: 5, S003: 4 };
const safeUnits = new Set(['U001', 'U002', 'U004']);
const stats = {
  U001: { attack: 2, armor: 2, move: 1, range: 1, hp: 8 },
  U002: { attack: 3, armor: 1, move: 1, range: 1, hp: 5 },
  U004: { attack: 3, armor: 0, move: 1, range: 3, hp: 4 },
};

function run(value) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
    input: JSON.stringify(value),
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(result.stderr.trim(), '', `runner stderr must be empty: ${result.stderr}`);
  assert.equal(result.stdout.trim().split('\n').length, 1, 'runner stdout must be one line');
  return { ...result, output: JSON.parse(result.stdout), bytes: result.stdout };
}

function next(value) {
  let state = value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return { value: (state >>> 0) / 4294967296, state: state | 0 };
}

function shuffle(values, seed) {
  const result = [...values];
  let state = seed;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = next(state);
    state = random.state;
    const swapIndex = Math.floor(random.value * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return { values: result, seed: state };
}

function target(units, attacker) {
  const distance = (candidate) => attacker.side === 'player' ? candidate.cell - attacker.cell : attacker.cell - candidate.cell;
  return units
    .filter((candidate) => candidate.side !== attacker.side && candidate.lane === attacker.lane && candidate.hp > 0 && distance(candidate) > 0 && distance(candidate) <= stats[attacker.cardId].range)
    .sort((a, b) => distance(a) - distance(b) || a.hp - b.hp || a.ref.localeCompare(b.ref))[0];
}

function autoTurn(units, side) {
  const ordered = units.filter((unit) => unit.side === side && unit.hp > 0).sort((a, b) => a.lane - b.lane || (side === 'player' ? -1 : 1) * (a.cell - b.cell) || a.ref.localeCompare(b.ref));
  for (const unit of ordered) {
    if (unit.hp <= 0) continue;
    let enemy = target(units, unit);
    if (!enemy) {
      const direction = side === 'player' ? 1 : -1;
      const nextCell = unit.cell + direction;
      if (nextCell >= 0 && nextCell < 12 && !units.some((candidate) => candidate.hp > 0 && candidate.lane === unit.lane && candidate.cell === nextCell)) unit.cell = nextCell;
      enemy = target(units, unit);
    }
    if (enemy) enemy.hp = Math.max(0, enemy.hp - Math.max(1, stats[unit.cardId].attack - stats[enemy.cardId].armor));
  }
  for (let index = units.length - 1; index >= 0; index -= 1) if (units[index].hp <= 0) units.splice(index, 1);
}

function explicitMove(units, ref, steps) {
  const unit = units.find((candidate) => candidate.ref === ref);
  if (!unit) return;
  const direction = unit.side === 'player' ? 1 : -1;
  for (let index = 0; index < steps; index += 1) {
    const nextCell = unit.cell + direction;
    if (nextCell < 0 || nextCell >= 12 || units.some((candidate) => candidate !== unit && candidate.hp > 0 && candidate.lane === unit.lane && candidate.cell === nextCell)) break;
    unit.cell = nextCell;
  }
}

function hasAutoAction(events) {
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== 'TURN_END') continue;
    for (let cursor = index + 1; cursor < events.length && events[cursor].type !== 'TURN_START'; cursor += 1) {
      if (events[cursor].type === 'UNIT_MOVED' || events[cursor].type === 'ATTACK' || events[cursor].type === 'DAMAGE') return true;
    }
  }
  return false;
}

function buildActions(seed) {
  const deck = fixture.decks.player.map((ref) => fixture.cards.find((card) => card.fixtureCardId === ref).reactCardId);
  const player = shuffle(deck, seed);
  const enemy = shuffle(deck, player.seed);
  const hands = {
    player: player.values.slice(0, 5).map((id) => ({ id, remaining: prepare[id] })),
    enemy: enemy.values.slice(0, 5).map((id) => ({ id, remaining: prepare[id] })),
  };
  const decks = { player: player.values.slice(5), enemy: enemy.values.slice(5) };
  let active = seed % 2 === 0 ? 'player' : 'enemy';
  for (const card of hands[active]) card.remaining = Math.max(0, card.remaining - 1);
  const actions = [{ type: 'BATTLE_START' }];
  const deployed = { player: [], enemy: [] };
  const units = [];
  const laneBySide = { player: 0, enemy: 0 };
  for (let guard = 0; guard < 160; guard += 1) {
    const ready = hands[active].filter((card) => card.remaining === 0 && safeUnits.has(card.id));
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
        const cell = cells[index];
        actions.push({ type: 'DEPLOY_UNIT', cardRef, unitRef, side, lane: laneBySide[side], cell });
        units.push({ ref: unitRef, side, lane: laneBySide[side], cell, hp: stats[card.id].hp, cardId: card.id });
        deployed[side].push(unitRef);
        hands[side].splice(hands[side].indexOf(card), 1);
      }
      if (deployed.player.length === 2 && deployed.enemy.length === 2) break;
      continue;
    }
    actions.push({ type: 'END_TURN' });
    autoTurn(units, active);
    for (const card of hands[active]) if (card.remaining === 0) card.remaining = Math.floor(prepare[card.id] / 2);
    const drawn = decks[active].shift();
    if (drawn) hands[active].push({ id: drawn, remaining: prepare[drawn] });
    active = active === 'player' ? 'enemy' : 'player';
    for (const card of hands[active]) card.remaining = Math.max(0, card.remaining - 1);
  }
  if (deployed.player.length === 2 && deployed.enemy.length === 2) {
    const first = units.find((unit) => unit.side === active);
    if (first) {
      actions.push({ type: 'MOVE_UNIT', unitRef: first.ref, steps: 2 });
      explicitMove(units, first.ref, 2);
    }
    for (let index = 0; index < 20; index += 1) {
      const attacker = units.find((unit) => unit.side === active && unit.hp > 0);
      const enemy = attacker ? target(units, attacker) : undefined;
      if (attacker && enemy) {
        actions.push({ type: 'ATTACK', unitRef: attacker.ref });
        enemy.hp = Math.max(0, enemy.hp - Math.max(1, stats[attacker.cardId].attack - stats[enemy.cardId].armor));
        if (enemy.hp <= 0) units.splice(units.indexOf(enemy), 1);
        break;
      }
      actions.push({ type: 'END_TURN' });
      autoTurn(units, active);
      active = active === 'player' ? 'enemy' : 'player';
    }
  }
  return actions;
}

function input(seed, actions = []) {
  return { protocol, seed, fixture: { ...fixture, actions } };
}

const emptyA = run(input(42));
const emptyB = run(input(42));
assert.equal(emptyA.status, 0);
assert.equal(emptyA.output.status, 'ok');
assert.equal(emptyA.output.fixtureVersion, 2);
assert.equal(emptyA.output.finalState.round, 1);
assert.equal(emptyA.output.finalState.hands.player.length, 5);
assert.equal(emptyA.bytes, emptyB.bytes, 'same seed and fixture must be byte deterministic');

const scenario = run(input(42, buildActions(42)));
assert.equal(scenario.status, 0);
assert.equal(scenario.output.status, 'ok');
assert.equal(scenario.output.events.some(({ type }) => type === 'UNIT_MOVED'), true);
assert.equal(scenario.output.events.some(({ type }) => type === 'ATTACK'), true);
assert.equal(hasAutoAction(scenario.output.events), true);
assert.equal(scenario.output.lifecycleEvents.length, 0);
assert.equal(scenario.output.finalState.units.every((unit) => unit.id.startsWith('unit-')), true);

const oneSideStream = buildActions(42);
let enemyDeployments = 0;
let oneSideEnd = oneSideStream.length;
for (let index = 0; index < oneSideStream.length; index += 1) {
  if (oneSideStream[index].type === 'DEPLOY_UNIT' && oneSideStream[index].side === 'enemy') enemyDeployments += 1;
  if (enemyDeployments === 2) {
    oneSideEnd = index + 1;
    break;
  }
}
const autoHero = run(input(42, [...oneSideStream.slice(0, oneSideEnd), ...Array.from({ length: 29 }, () => ({ type: 'END_TURN' }))]));
assert.equal(autoHero.status, 0);
assert.notEqual(autoHero.output.finalState.status, 'playing');
assert.equal(autoHero.output.events.filter(({ type }) => type === 'BATTLE_END').length, 1);

const round80 = run(input(42, [{ type: 'BATTLE_START' }, ...Array.from({ length: 160 }, () => ({ type: 'END_TURN' }))]));
assert.equal(round80.status, 0);
assert.equal(round80.output.finalState.round, 80);
assert.equal(round80.output.events.filter(({ type }) => type === 'BATTLE_END').length, 1);
assert.equal(round80.output.lifecycleEvents.length, 1);
assert.equal(round80.output.lifecycleEvents[0].type, 'BATTLE_END');

for (const [label, value, code] of [
  ['wrong version', { ...input(1), fixture: { ...fixture, version: 1 } }, 'INVALID_INPUT'],
  ['state rehydration', { ...input(1), finalState: {} }, 'STATE_REHYDRATION_FORBIDDEN'],
  ['unknown card mapping', { ...input(1), fixture: { ...fixture, cards: fixture.cards.map((card, index) => index === 0 ? { ...card, cocosCardId: 'U999' } : card) } }, 'INVALID_INPUT'],
]) {
  const result = run(value);
  assert.notEqual(result.status, 0, `${label} must fail`);
  assert.equal(result.output.status, 'error');
  assert.equal(result.output.error.code, code);
}

const hashes = new Set();
const coverage = new Set();
const eventCoverage = new Set();
let automaticCoverage = false;
let blockedCoverage = false;
for (let seed = 1; seed <= 100; seed += 1) {
  const actions = buildActions(seed);
  for (const action of actions) coverage.add(action.type);
  const result = run(input(seed, actions));
  assert.equal(result.status, 0, `seed ${seed} must run`);
  assert.equal(result.output.status, 'ok');
  for (const event of result.output.events) eventCoverage.add(event.type);
  blockedCoverage ||= result.output.events.some((event) => event.type === 'UNIT_MOVED' && event.payload?.blocked === 'occupied');
  automaticCoverage ||= hasAutoAction(result.output.events);
  hashes.add(result.output.finalHash);
}
assert(hashes.size > 1, '100 deterministic seeds must produce distinct raw results');
for (const type of ['DEPLOY_UNIT', 'MOVE_UNIT', 'ATTACK', 'END_TURN']) assert(coverage.has(type), `100 seed corpus must cover ${type}`);
for (const type of ['UNIT_MOVED', 'ATTACK', 'DAMAGE']) assert(eventCoverage.has(type), `100 seed corpus must emit ${type}`);
assert(blockedCoverage, '100 seed corpus must cover occupied-cell blocking');
assert(automaticCoverage, '100 seed corpus must execute automatic movement or attack between turn boundaries');

console.log('Parity contract v2: explicit mapping input, raw state runner, block/attack/auto-turn coverage, errors, round80, 100 seeds PASS');
