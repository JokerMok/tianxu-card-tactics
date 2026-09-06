import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

if (!vm.SourceTextModule) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', '--experimental-strip-types', import.meta.filename], {
    stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  process.exit(child.status ?? 1);
}

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'assets/scripts/battle/runtime/browser-battle-core.ts');
assert(fs.existsSync(entry), 'browser battle core entry must exist');
const context = vm.createContext({}); // No process, require, Buffer, or filesystem in the execution realm.
const modules = new Map();
function moduleFor(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'));
  assert.doesNotMatch(source, /\b(?:process|require|Buffer)\b|node:|\bimport\s*\(/, filename);
  const module = new vm.SourceTextModule(source, { context, identifier: filename });
  modules.set(filename, module);
  return module;
}
const browser = moduleFor(entry);
await browser.link((specifier, parent) => {
  assert(specifier.startsWith('.'), `browser dependency must be relative: ${specifier}`);
  const filename = path.resolve(path.dirname(parent.identifier), specifier);
  assert(filename.startsWith(path.join(root, 'assets/scripts/')), filename);
  return moduleFor(filename);
});
await browser.evaluate();
const { createBattleCore } = browser.namespace;
assert.equal(typeof createBattleCore, 'function');
const json = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const config = Object.fromEntries(['cards', 'skills', 'units', 'professions', 'decks'].map((name) => [
  name, json(path.join(root, `assets/resources/config/${name}.json`))[name],
]));
const normal = json(path.join(import.meta.dirname, 'fixtures/battle-runner/normal.json'));
const fixture = json(path.resolve(root, '../web-prototype/tests/parity/fixture.json'));
const core = createBattleCore(config);
assert.equal(core.runBattleRunner(normal).finalHash, '4f31b0d8', 'normal fixture hash from base d2eeefdb');
const runtimeModule = modules.get(path.join(path.dirname(entry), 'battle-core.ts')).namespace;
const configModule = modules.get(path.join(path.dirname(entry), 'battle-config.ts')).namespace;
const calls = new Map();
const bindings = Object.fromEntries(Object.entries(runtimeModule.DEFAULT_BATTLE_BINDINGS).map(([name, value]) => [
  name, typeof value !== 'function' ? value : (...args) => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
    return value(...args);
  },
]));
const boundRuntime = runtimeModule.createBattleRuntime(configModule.createAuthority(config), bindings);
boundRuntime.runBattleRunner(normal);
boundRuntime.runBattleRunnerV2({ protocol: 'tianxu.cocos-battle-runner/v2', seed: 42, fixture });
for (const [name, value] of Object.entries(bindings)) {
  if (typeof value === 'function') assert(calls.get(name) > 0, `execution must use the ${name} binding`);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const input = (seed, actions = []) => ({ protocol: normal.protocol, seed, actions });
function cli(value) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'assets/scripts/battle/runner/battle-runner.ts')], {
    input: JSON.stringify(value), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.trim().split('\n').length, 1);
  return { status: child.status, output: JSON.parse(child.stdout) };
}
for (const value of [normal, input(42), input(0, [{ type: 'BATTLE_START' }]),
  input(42, [{ type: 'BATTLE_START' }, ...Array.from({ length: 158 }, () => ({ type: 'END_TURN' }))]),
  ...['P001', 'P002', 'P003', 'P004'].map((professionId) => ({ ...input(223, [{ type: 'BATTLE_START' }]), professionId })),
]) {
  const result = cli(value);
  assert.equal(result.status, 0);
  assert.deepEqual(plain(core.runBattleRunner(value)), result.output, 'browser/CLI v1 state, events and hash');
}
for (const seed of [1, 42, 223]) {
  const value = { protocol: 'tianxu.cocos-battle-runner/v2', seed, fixture: {
    ...fixture, actions: [{ type: 'BATTLE_START' }, ...Array.from({ length: 160 }, () => ({ type: 'END_TURN' }))],
  } };
  const result = cli(value);
  assert.equal(result.status, 0);
  assert.deepEqual(plain(core.runBattleRunnerV2(value)), result.output, 'browser/CLI v2 parity');
}

// Legal deck changes, alternating factories, and caller mutations must not leak.
const sourceA = structuredClone(config);
const sourceB = structuredClone(config);
sourceB.decks[0].cardEntries.reverse();
const a = createBattleCore(sourceA);
const b = createBattleCore(sourceB);
const beforeA = plain(a.runBattleRunner(input(223)));
const beforeB = plain(b.runBattleRunner(input(223)));
const combatA = plain(a.runBattleRunner(normal));
const professionInput = { ...input(223, [{ type: 'BATTLE_START' }]), professionId: 'P001' };
const professionA = plain(a.runBattleRunner(professionInput));
assert.notEqual(beforeA.finalHash, beforeB.finalHash);
sourceA.cards[0].prepare = 999;
sourceA.units[0].maxHp = 999;
sourceA.professions[0].skillIds.length = 0;
sourceA.decks[0].cardEntries.length = 0;
sourceB.decks[0].cardEntries.reverse();
for (let index = 0; index < 3; index += 1) {
  assert.deepEqual(plain(b.runBattleRunner(input(223))), beforeB);
  assert.deepEqual(plain(a.runBattleRunner(input(223))), beforeA);
  assert.deepEqual(plain(a.runBattleRunner(normal)), combatA);
  assert.deepEqual(plain(a.runBattleRunner(professionInput)), professionA);
}
assert.equal(Object.isFrozen(config.cards[0]), false, 'factory must not freeze caller-owned objects');
for (const mutate of [
  (c) => { c.cards = []; },
  (c) => { c.decks = []; },
  (c) => { c.decks[0].cardEntries = []; },
  (c) => { c.decks[0].cardEntries[0].cardId = 'UNKNOWN'; },
  (c) => { c.decks[0].cardEntries[0].count = -1; },
  (c) => { c.cards[0].unitId = 'UNKNOWN'; },
  (c) => { c.cards[0].prepare = NaN; },
  (c) => { c.units[0].maxHp = -1; },
  (c) => { c.cards.push(structuredClone(c.cards[0])); },
  (c) => { c.professions[0].skillIds = ['UNKNOWN']; },
]) {
  const invalid = structuredClone(config);
  mutate(invalid);
  assert.throws(() => createBattleCore(invalid), undefined, 'invalid configuration must reject at factory creation');
}
assert.throws(() => createBattleCore({}));
assert.throws(() => createBattleCore(config, { deckId: 'UNKNOWN' }));
assert.throws(() => createBattleCore(config, { levelId: 'UNKNOWN' }));
const multipleDecks = structuredClone(config);
multipleDecks.decks.push({ ...structuredClone(config.decks[0]), id: 'D002',
  cardEntries: structuredClone(config.decks[0].cardEntries).reverse() });
assert.deepEqual(plain(createBattleCore(multipleDecks, { deckId: 'D002' }).runBattleRunner(input(223))), beforeB);
for (const value of [input(1, [{ type: 'MOVE_UNIT', unitId: 'missing' }]),
  { ...input(1), professionId: 'UNKNOWN' }, { ...input(1), finalState: {} },
  { ...input(1), levelId: 'UNKNOWN' },
  input(1, [{ type: 'BATTLE_START', finalState: {} }]), input(1.5),
]) {
  const rejected = cli(value);
  assert.notEqual(rejected.status, 0);
  assert.throws(() => core.runBattleRunner(value), (error) => error.code === rejected.output.error.code
    && error.message === rejected.output.error.message);
}
assert.deepEqual(plain(a.runBattleRunner(input(223))), beforeA, 'rejection must not affect later runs');
const exported = await import('../assets/scripts/battle/runner/battle-runner.ts');
assert.deepEqual(plain(core.runNeutralBattle(42)), plain(exported.runNeutralBattle(42)), 'neutral export parity');
console.log(`Browser battle core: isolated realm (${modules.size} modules), CLI parity, configuration isolation and rejection PASS`);
