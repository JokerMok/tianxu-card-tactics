import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runBattleRunner, BATTLE_RUNNER_PROTOCOL } from '../assets/scripts/battle/runner/battle-runner.ts';

const protocol = BATTLE_RUNNER_PROTOCOL;
const runnerPath = path.resolve(import.meta.dirname, '../assets/scripts/battle/runner/battle-runner.ts');
const configRoot = path.resolve(import.meta.dirname, '../assets/resources/config');
const professionsTable = JSON.parse(fs.readFileSync(path.join(configRoot, 'professions.json'), 'utf8'));
const cardsTable = JSON.parse(fs.readFileSync(path.join(configRoot, 'cards.json'), 'utf8'));
const enabledCards = new Map(cardsTable.cards.filter((card) => card.enabled !== false).map((card) => [card.id, card]));

function input(professionId, seed, actions) {
  return { protocol, seed, ...(professionId === undefined ? {} : { professionId }), actions };
}

function run(professionId, seed, actions) {
  return runBattleRunner(input(professionId, seed, actions));
}

function playerTurn(professionId, seed = 1) {
  const actions = [{ type: 'BATTLE_START' }];
  let state = run(professionId, seed, actions).finalState;
  if (state.activeSide === 'enemy') actions.push({ type: 'END_TURN' });
  state = run(professionId, seed, actions).finalState;
  assert.equal(state.activeSide, 'player', `${professionId} must reach the player turn`);
  return { actions, state };
}

function commanderFlow(seed = 1) {
  const { actions, state } = playerTurn('P001', seed);
  const units = state.hands.player.filter((card) => /^U\d{3}$/.test(card.cardId));
  assert(units.length >= 2, 'commander flow needs two real unit cards');
  actions.push({ type: 'DEPLOY_UNIT', cardId: units[0].cardId, side: 'player', lane: 0, cell: 0 });
  actions.push({ type: 'DEPLOY_UNIT', cardId: units[1].cardId, side: 'player', lane: 0, cell: 1 });
  return run('P001', seed, actions);
}

function arcanistFlow(seed = 1) {
  const { actions, state } = playerTurn('P002', seed);
  const playerUnit = state.hands.player.find((card) => /^U\d{3}$/.test(card.cardId));
  assert(playerUnit, 'arcanist flow needs a real player unit card');
  actions.push({ type: 'DEPLOY_UNIT', cardId: playerUnit.cardId, side: 'player', lane: 0, cell: 0 });
  actions.push({ type: 'END_TURN' });
  let next = run('P002', seed, actions).finalState;
  assert.equal(next.activeSide, 'enemy');
  const enemyUnit = next.hands.enemy.find((card) => /^U\d{3}$/.test(card.cardId));
  assert(enemyUnit, 'arcanist flow needs a real enemy unit card');
  actions.push({ type: 'DEPLOY_UNIT', cardId: enemyUnit.cardId, side: 'enemy', lane: 0, cell: 11 });
  actions.push({ type: 'END_TURN' });
  next = run('P002', seed, actions).finalState;
  assert.equal(next.activeSide, 'player');
  const spell = next.hands.player.find((card) => card.cardId === 'S001');
  assert(spell && spell.remainingPreparation === 0, 'arcanist must use the real S001 skill card when ready');
  const cast = { type: 'PLAY_CARD', cardId: 'S001', side: 'player', target: { kind: 'unit', unitId: 'unit-enemy-2' } };
  actions.push(cast, { ...cast });
  return run('P002', seed, actions);
}

function covenantFlow(seed = 1) {
  const { actions, state } = playerTurn('P003', seed);
  const playerUnit = state.hands.player.find((card) => /^U\d{3}$/.test(card.cardId));
  assert(playerUnit, 'covenant flow needs a real player unit card');
  actions.push({ type: 'DEPLOY_UNIT', cardId: playerUnit.cardId, side: 'player', lane: 0, cell: 0 });
  actions.push({ type: 'END_TURN' });
  actions.push(
    { type: 'APPLY_DOT', side: 'enemy', targetIds: ['unit-player-1'], amount: 1 },
    { type: 'APPLY_DOT', side: 'enemy', targetIds: ['unit-player-1'], amount: 1 },
    { type: 'END_TURN' },
    { type: 'END_TURN' },
    { type: 'APPLY_DOT', side: 'enemy', targetIds: ['unit-player-1'], amount: 1 },
  );
  return run('P003', seed, actions);
}

function tacticianFlow(seed = 1) {
  const before = run('P004', seed, []).finalState;
  const after = run('P004', seed, [{ type: 'BATTLE_START' }]).finalState;
  return { before, after };
}

for (const profession of professionsTable.professions.filter((candidate) => candidate.enabled !== false)) {
  const snapshot = run(profession.id, 1, []).finalState;
  const allCards = [...snapshot.decks.player, ...snapshot.hands.player.map((card) => card.cardId), ...snapshot.graveyards.player];
  assert.equal(allCards.length, 30, `${profession.id} must derive a real 30-card player deck`);
  const skillCards = allCards.filter((cardId) => enabledCards.get(cardId)?.cardType === 'SKILL');
  assert.equal(skillCards.length, profession.skillIds.length, `${profession.id} must use its real skill pool`);
  assert.deepEqual(new Set(skillCards), new Set(profession.skillIds), `${profession.id} skill cards must come from T212 metadata`);
  assert(allCards.filter((cardId) => enabledCards.get(cardId)?.cardType === 'UNIT').length >= 24, `${profession.id} must keep the unit minimum`);
}

const commander = commanderFlow();
assert.equal(commander.finalState.professionState.professionId, 'P001');
assert.equal(commander.finalState.professionState.logs.length, 1, 'commander must trigger once per lane');
assert.equal(commander.finalState.professionState.barrierByUnit['unit-player-1'], 2);
assert.equal(commander.finalState.units[0].statuses.find((status) => status.kind === 'BARRIER')?.value, 2, 'barrier must be in serializable unit state');
assert.equal(commander.finalState.professionState.logs[0].trigger, 'FIRST_DEPLOY_PER_LANE');

const arcanist = arcanistFlow();
assert.equal(arcanist.finalState.professionState.professionId, 'P002');
assert.equal(arcanist.finalState.professionState.logs.length, 2, 'one valid spell may trigger once for each distinct action');
assert.equal(arcanist.finalState.professionState.spellResistanceIgnore, 2, 'spell resistance bypass must be a state value');
assert.equal(Object.values(arcanist.finalState.professionState.actionTriggers).every((count) => count === 1), true);
assert.throws(
  () => run('P002', 1, [{ type: 'BATTLE_START' }, { type: 'PLAY_CARD', cardId: 'S001', side: 'player', target: { kind: 'lane', lane: 0 } }]),
  /target kind|not in player hand|not ready/,
  'wrong spell timing or target must not trigger arcanist',
);

const covenant = covenantFlow();
assert.equal(covenant.finalState.professionState.professionId, 'P003');
assert.equal(covenant.finalState.professionState.logs.length, 2, 'covenant must trigger once per round');
assert.equal(covenant.finalState.professionState.dotDamageReduction, 2);
assert.equal(covenant.finalState.professionState.dotDamageReduced, 2);
assert.equal(covenant.finalState.units[0].hp, covenant.finalState.units[0].maxHp - 1, 'DOT reduction must change actual unit HP');
assert.equal(covenant.finalState.events.filter(({ type }) => type === 'DAMAGE_OVER_TIME').length, 3);

const tactician = tacticianFlow();
const tacticianTargetId = tactician.after.professionState.logs[0].objectIds[0];
const tacticianBefore = tactician.before.hands.player.find((card) => card.instanceId === tacticianTargetId);
const tacticianAfter = tactician.after.hands.player.find((card) => card.instanceId === tacticianTargetId);
assert(tacticianBefore && tacticianAfter, 'tactician must select a real hand card');
assert.equal(tacticianAfter.remainingPreparation, Math.max(0, tacticianBefore.remainingPreparation - (tactician.before.activeSide === 'player' ? 1 : 0) - 1));
assert.equal(tactician.after.professionState.preparationReduction, 1);
assert.equal(tactician.after.professionState.logs.length, 1);

assert.equal(run(undefined, 42, []).finalState.professionState, undefined, 'legacy runner input remains profession-neutral');
assert.throws(() => run('P999', 1, []), /authoritative profession/);
assert.throws(() => run('P001', 1, [{ type: 'BATTLE_START', cardType: 'SKILL' }]), /unsupported field/);
assert.throws(() => run('P001', 1, [{ type: 'BATTLE_START', professionState: {} }]), /seed-derived/);
assert.throws(
  () => run('P001', 1, [{ type: 'BATTLE_START' }, { type: 'PLAY_CARD', cardId: 'S001', side: 'player', target: { kind: 'unit', unitId: 'missing' } }]),
  /real profession skill pool|not in player hand|target unit/,
  'cross-profession or invalid skill input must be rejected',
);
assert.throws(
  () => run('P003', 1, [{ type: 'BATTLE_START' }, { type: 'APPLY_DOT', side: 'player', targetIds: ['missing'], amount: 1 }]),
  /side must be active|living unit/,
  'invalid DOT input must not create a profession trigger',
);
assert.throws(() => run('P004', 1, [{ type: 'BATTLE_START' }, { type: 'BATTLE_START' }]), /may only be issued once/);

const determinismInput = input('P004', 77, [{ type: 'BATTLE_START' }]);
const deterministicA = JSON.stringify(runBattleRunner(determinismInput));
const deterministicB = JSON.stringify(runBattleRunner(determinismInput));
assert.equal(deterministicA, deterministicB, 'profession runtime must be byte-stable for identical input');
const bytesA = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], { input: `${JSON.stringify(determinismInput)}\n`, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
const bytesB = spawnSync(process.execPath, ['--experimental-strip-types', runnerPath], { input: `${JSON.stringify(determinismInput)}\n`, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
assert.equal(bytesA.status, 0);
assert.equal(bytesA.stderr, '');
assert.equal(bytesA.stdout, bytesB.stdout, 'runner process output must be byte deterministic');

const hashes = new Set();
for (let seed = 1; seed <= 100; seed += 1) {
  const professionId = ['P001', 'P002', 'P003', 'P004'][(seed - 1) % 4];
  const result = run(professionId, seed, [{ type: 'BATTLE_START' }]);
  assert.equal(result.finalState.professionState.professionId, professionId);
  hashes.add(result.finalHash);
}
assert(hashes.size >= 2, '100 profession seeds must produce non-identical canonical results');

console.log('Hero Profession Runtime: four real professions, serializable state changes, timing/repeat/invalid input, 100 seeds and byte determinism PASS');
