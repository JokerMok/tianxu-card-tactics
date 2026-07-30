import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const runnerPath = path.join(root, 'assets/scripts/battle/runner/battle-runner.ts');
const fixturePath = path.join(import.meta.dirname, 'fixtures/battle-runner/normal.json');

assert.equal(fs.existsSync(runnerPath), true, `battle runner is missing: ${runnerPath}`);
const source = fs.readFileSync(runnerPath, 'utf8');
assert.doesNotMatch(source, /replayCommands|web-prototype|React/i, 'battle runner must not be replay or React code');
for (const moduleName of ['core/board', 'core/movement', 'core/combat', 'core/events', 'core/outcome', 'core/rng']) {
  assert.match(source, new RegExp(`core/${moduleName.split('/')[1]}`), `${moduleName} must be called by the runner`);
}

function runText(input) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], {
    input,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(result.stderr.trim(), '', `runner stderr must be empty: ${result.stderr}`);
  assert.equal(result.stdout.trim().split('\n').length, 1, 'runner stdout must be one line');
  return { ...result, output: JSON.parse(result.stdout), bytes: result.stdout };
}

function runValue(value) {
  return runText(JSON.stringify(value));
}

function input(seed, actions) {
  return { protocol: 'tianxu.cocos-battle-runner/v1', seed, actions };
}

function expectError(label, value, code) {
  const result = runValue(value);
  assert.notEqual(result.status, 0, `${label} must exit non-zero`);
  assert.equal(result.output.status, 'error', `${label} must return error JSON`);
  assert.equal(result.output.error.code, code, `${label} must return ${code}`);
  return result.output.error.message;
}

function expectRawError(label, raw, code) {
  const result = runText(raw);
  assert.notEqual(result.status, 0, `${label} must exit non-zero`);
  assert.equal(result.output.status, 'error', `${label} must return error JSON`);
  assert.equal(result.output.error.code, code, `${label} must return ${code}`);
}

const normalText = fs.readFileSync(fixturePath, 'utf8');
const normalResult = runText(normalText);
const output = normalResult.output;
assert.equal(normalResult.status, 0);
assert.equal(output.protocol, 'tianxu.cocos-battle-runner/v1');
assert.equal(output.status, 'ok');
assert.equal(output.runner, 'cocos-battle');
assert.equal(output.finalState.units.length, 2);
assert.equal(output.finalState.units.find((unit) => unit.id === 'unit-player-1').cell, 2);
assert.equal(output.finalState.units.find((unit) => unit.id === 'unit-enemy-2').cell, 3);
assert.equal(output.finalState.units.find((unit) => unit.id === 'unit-enemy-2').hp, 3);
assert.equal(output.events.some(({ type }) => type === 'ATTACK'), true, 'core combat must produce ATTACK');
assert.equal(output.events.some(({ type, payload }) => type === 'UNIT_MOVED' && payload.blocked === 'occupied'), true, 'core movement must report a blocking unit');
assert.equal(output.finalState.round, 3);
assert.equal(output.finalState.status, 'playing');
assert.equal(output.outcome.status, 'playing');
assert.equal(output.rngCursor, output.finalState.rngCursor);
assert.equal(typeof output.finalHash, 'string');

const empty = runValue(input(42, []));
assert.equal(empty.status, 0);
assert.equal(empty.output.finalState.round, 0);
assert.equal(empty.output.finalState.heroHp.player, 30);
assert.equal(empty.output.finalState.heroHp.enemy, 30);
assert.equal(empty.output.finalState.units.length, 0);
assert.equal(empty.output.outcome.status, 'playing');
assert(empty.output.rngCursor > 0, 'seed-derived card state must advance rng');

const round80 = runValue(input(42, [
  { type: 'BATTLE_START' },
  ...Array.from({ length: 158 }, () => ({ type: 'END_TURN' })),
]));
assert.equal(round80.status, 0);
assert.equal(round80.output.finalState.round, 80);
assert.equal(round80.output.finalState.status, 'won', 'round 80 tie must be resolved by outcome');
assert.equal(round80.output.outcome.reason, 'ROUND_LIMIT');
assert.equal(round80.output.events.filter(({ type }) => type === 'BATTLE_END').length, 1, 'round limit settles once');

const heroDeath = runValue(input(223, [
  { type: 'BATTLE_START' },
  { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 },
  { type: 'MOVE_UNIT', unitId: 'unit-player-1', steps: 11 },
  ...Array.from({ length: 10 }, () => ({ type: 'ATTACK', attackerId: 'unit-player-1' })),
]));
assert.equal(heroDeath.status, 0);
assert.equal(heroDeath.output.finalState.heroHp.enemy, 0);
assert.equal(heroDeath.output.finalState.status, 'won');
assert.equal(heroDeath.output.outcome.reason, 'HERO_DEFEATED');
assert.equal(heroDeath.output.events.filter(({ type }) => type === 'BATTLE_END').length, 1, 'hero death settles once');

expectError('state rehydration at root', { ...input(1, []), heroHp: { player: 1, enemy: 1 } }, 'STATE_REHYDRATION_FORBIDDEN');
expectError('state rehydration in action', input(1, [{ type: 'BATTLE_START', finalState: {} }]), 'STATE_REHYDRATION_FORBIDDEN');
expectError('invalid high-level action', input(1, [{ type: 'TELEPORT_HACK' }]), 'INVALID_COMMAND');
expectError('invalid card id', input(223, [{ type: 'BATTLE_START' }, { type: 'DEPLOY_UNIT', cardId: 'U999', side: 'player', lane: 0, cell: 0 }]), 'INVALID_COMMAND');
expectError('invalid unit id', input(223, [{ type: 'BATTLE_START' }, { type: 'MOVE_UNIT', unitId: 'missing-unit' }]), 'INVALID_COMMAND');
expectRawError('invalid JSON', '{', 'INVALID_JSON');

const repeatedA = runText(normalText);
const repeatedB = runText(normalText);
assert.equal(repeatedA.bytes, repeatedB.bytes, 'same input bytes must produce same output bytes');
assert.notEqual(empty.output.finalHash, runValue(input(43, [])).output.finalHash, 'different seed must change actual canonical result');
assert.notEqual(empty.output.finalHash, runValue(input(42, [{ type: 'BATTLE_START' }])).output.finalHash, 'different high-level action must change actual result');

const hundredSeedHashes = new Set();
for (let seed = 1; seed <= 100; seed += 1) {
  const opened = runValue(input(seed, [{ type: 'BATTLE_START' }]));
  const side = opened.output.finalState.activeSide;
  const card = opened.output.finalState.hands[side].find(({ cardId }) => /^U\d{3}$/.test(cardId));
  assert(card, `seed ${seed} must expose a config-driven unit card in the active hand`);
  const cell = side === 'player' ? 0 : 11;
  const stream = [
    { type: 'BATTLE_START' },
    { type: 'DEPLOY_UNIT', cardId: card.cardId, side, lane: seed % 2, cell },
    { type: 'MOVE_UNIT', unitId: `unit-${side}-1`, steps: seed % 3 },
    { type: 'END_TURN' },
  ];
  const result = runValue(input(seed, stream));
  assert.equal(result.status, 0, `seed ${seed} flow must be executable`);
  assert.equal(result.output.finalState.units.length, 1);
  hundredSeedHashes.add(result.output.finalHash);
}
assert(hundredSeedHashes.size >= 2, '100 seed flows must produce non-identical actual results');

console.log('Battle Runner: normal movement/blocking/targeting, empty, round 80, hero death, invalid input, 100 seeds, byte determinism PASS');
