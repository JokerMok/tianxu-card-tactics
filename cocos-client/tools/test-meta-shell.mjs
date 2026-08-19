import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  SHELL_DEFAULT_SNAPSHOT_SHA256,
  SHELL_LAYOUT_CONTRACT,
  SHELL_LAYOUT_CONTRACT_SHA256,
  SHELL_NAVIGATION,
  SHELL_RESOURCE_DEFINITIONS,
  ShellContractError,
  ShellService,
  createDefaultShellState,
  serializeShellState,
} from '../assets/scripts/meta/ui/shell/index.ts';

const shellSource = fs.readFileSync(new URL('../assets/scripts/meta/ui/shell/ShellService.ts', import.meta.url), 'utf8');
assert.doesNotMatch(shellSource, /(?:from|require\()\s*["'](?:node:|cc)/, 'shell service must remain Cocos-adapter friendly');
assert.doesNotMatch(shellSource, /\b(?:window|document|setTimeout|setInterval)\b/, 'shell service must not own platform or timer state');

const hash = (value) => createHash('sha256').update(value).digest('hex');
let negativeCaseCount = 0;
const expectError = (action, code) => {
  negativeCaseCount += 1;
  return assert.throws(action, (error) => error instanceof ShellContractError && error.code === code, `expected ${code}`);
};

const EXPECTED_LAYOUT_HASH = '4dee6014303f2ab744937d46fcc837b7301812c4940f89e02a0b5aea5dea1c54';
const EXPECTED_DEFAULT_SERIALIZED = '{"schemaVersion":1,"page":"home","history":[],"navigation":[{"id":"home","enabled":true},{"id":"campaign","enabled":true},{"id":"cards","enabled":true},{"id":"deck","enabled":true},{"id":"hero","enabled":true},{"id":"adventure","enabled":true},{"id":"city","enabled":true},{"id":"tasks","enabled":true},{"id":"inventory","enabled":true}],"resources":[{"id":"stamina","value":82,"max":100},{"id":"silver","value":12800,"max":null},{"id":"crystal","value":460,"max":null},{"id":"towerTicket","value":3,"max":null}]}';
const EXPECTED_DEFAULT_HASH = 'b366d6a2510f5bb08b91e8a53c87eb5d1d5f05ebd1d4efba9341988abdfd663d';

// The baseline is concrete: dimensions, anchor geometry, navigation order, resource order, and bytes are fixed.
assert.deepEqual(SHELL_LAYOUT_CONTRACT.designResolution, { width: 1920, height: 1080 });
assert.deepEqual(SHELL_LAYOUT_CONTRACT.topBar, { x: 0, y: 494, width: 1920, height: 92 });
assert.deepEqual(SHELL_LAYOUT_CONTRACT.navigation, {
  x: -855, y: -46, width: 210, height: 988, itemX: 10, itemWidth: 178, itemHeight: 68, firstItemY: 390, itemStepY: -91,
});
assert.deepEqual(SHELL_LAYOUT_CONTRACT.topBarResources.map(({ id, label, anchorX, valueFormat }) => ({ id, label, anchorX, valueFormat })), [
  { id: 'stamina', label: '体力', anchorX: 190, valueFormat: 'current/max' },
  { id: 'silver', label: '银币', anchorX: 390, valueFormat: 'compact' },
  { id: 'crystal', label: '水晶', anchorX: 590, valueFormat: 'compact' },
]);
assert.equal(hash(JSON.stringify(SHELL_LAYOUT_CONTRACT)), EXPECTED_LAYOUT_HASH);
assert.equal(SHELL_LAYOUT_CONTRACT_SHA256, EXPECTED_LAYOUT_HASH);
assert.deepEqual(SHELL_NAVIGATION.map(({ id }) => id), ['home', 'campaign', 'cards', 'deck', 'hero', 'adventure', 'city', 'tasks', 'inventory']);
assert.deepEqual(SHELL_RESOURCE_DEFINITIONS.map(({ id }) => id), ['stamina', 'silver', 'crystal', 'towerTicket']);

// Default state and byte-level serialization are the screenshot/layout baseline inputs.
const defaultState = createDefaultShellState();
const defaultService = new ShellService();
assert.deepEqual(defaultState, defaultService.snapshot());
assert.equal(defaultService.serialize(), EXPECTED_DEFAULT_SERIALIZED);
assert.equal(hash(defaultService.serialize()), EXPECTED_DEFAULT_HASH);
assert.equal(SHELL_DEFAULT_SNAPSHOT_SHA256, EXPECTED_DEFAULT_HASH);
assert.equal(serializeShellState(defaultState), EXPECTED_DEFAULT_SERIALIZED);
assert.equal(defaultState.navigation.filter((entry) => entry.selected).map((entry) => entry.id).join(','), 'home');
assert.deepEqual(defaultState.resources.map(({ id, value, max }) => ({ id, value, max })), [
  { id: 'stamina', value: 82, max: 100 },
  { id: 'silver', value: 12800, max: null },
  { id: 'crystal', value: 460, max: null },
  { id: 'towerTicket', value: 3, max: null },
]);

// Resource updates are observable, capped, integer-safe, and atomic on failure.
const service = new ShellService();
assert.equal(service.setResource('silver', 13_500), true);
assert.equal(service.resource('silver').value, 13_500);
assert.equal(service.adjustResource('crystal', 40), true);
assert.equal(service.resource('crystal').value, 500);
assert.equal(service.adjustResource('stamina', 18), true);
assert.equal(service.resource('stamina').value, 100);
const resourceBeforeReject = service.snapshot();
expectError(() => service.setResource('stamina', 101), 'RESOURCE_LIMIT');
assert.strictEqual(service.snapshot(), resourceBeforeReject);
expectError(() => service.setResource('stamina', -1), 'INVALID_NUMBER');
expectError(() => service.setResource('silver', Number.NaN), 'INVALID_NUMBER');
expectError(() => service.setResource('silver', Number.POSITIVE_INFINITY), 'INVALID_NUMBER');
expectError(() => service.setResource('silver', 1.5), 'INVALID_NUMBER');
expectError(() => service.adjustResource('silver', Number.MAX_SAFE_INTEGER), 'RESOURCE_LIMIT');
expectError(() => service.adjustResource('silver', -13_501), 'RESOURCE_LIMIT');
expectError(() => service.resource('missing'), 'RESOURCE_NOT_FOUND');
assert.equal(service.setResource('silver', 13_500), false, 'same value must not create a state transition');
expectError(() => service.setResourceMax('stamina', 99), 'RESOURCE_LIMIT');
assert.equal(service.setResourceMax('silver', 20_000), true);
expectError(() => service.setResource('silver', 20_001), 'RESOURCE_LIMIT');
assert.equal(service.setResourceMax('silver', null), true);
expectError(() => service.setResourceMax('stamina', null), 'RESOURCE_LIMIT');

// Navigation has explicit selected state, availability, unknown-id rejection, duplicate-click idempotence, and back behavior.
const navigationService = new ShellService();
const selectedBefore = navigationService.snapshot();
assert.deepEqual(navigationService.navigate('campaign'), { accepted: true, changed: true, page: 'campaign', reason: 'selected' });
assert.equal(navigationService.snapshot().page, 'campaign');
assert.deepEqual(navigationService.snapshot().navigation.filter((entry) => entry.selected).map((entry) => entry.id), ['campaign']);
const duplicatePageSnapshot = navigationService.snapshot();
assert.deepEqual(navigationService.selectPage('campaign'), { accepted: true, changed: false, page: 'campaign', reason: 'same' });
assert.strictEqual(navigationService.snapshot(), duplicatePageSnapshot);
assert.notStrictEqual(navigationService.snapshot(), selectedBefore);
expectError(() => navigationService.navigate('not-a-page'), 'PAGE_NOT_FOUND');
assert.equal(navigationService.setPageEnabled('campaign', false), true);
assert.equal(navigationService.snapshot().page, 'home', 'disabling current page must fall back to the first enabled page');
const disabledSnapshot = navigationService.snapshot();
assert.deepEqual(navigationService.navigate('campaign'), { accepted: false, changed: false, page: 'home', reason: 'disabled' });
assert.strictEqual(navigationService.snapshot(), disabledSnapshot);
expectError(() => navigationService.setPageEnabled('unknown', true), 'PAGE_NOT_FOUND');
expectError(() => navigationService.setPageEnabled('home', 'yes'), 'INVALID_BOOLEAN');
assert.equal(navigationService.setPageEnabled('campaign', true), true);
assert.deepEqual(navigationService.navigate('campaign'), { accepted: true, changed: true, page: 'campaign', reason: 'selected' });
assert.deepEqual(navigationService.navigate('cards'), { accepted: true, changed: true, page: 'cards', reason: 'selected' });
assert.deepEqual(navigationService.back(), { accepted: true, changed: true, page: 'campaign', reason: 'back' });
assert.deepEqual(navigationService.back(), { accepted: true, changed: true, page: 'home', reason: 'back' });
assert.deepEqual(navigationService.back(), { accepted: false, changed: false, page: 'home', reason: 'back' });
assert.equal(navigationService.setPageEnabled('home', false), true);
assert.equal(navigationService.snapshot().page, 'campaign');
for (const entry of navigationService.snapshot().navigation.filter(({ enabled }) => enabled)) {
  if (entry.id !== 'campaign') assert.equal(navigationService.setPageEnabled(entry.id, false), true);
}
const lastPageBeforeDisable = navigationService.snapshot();
expectError(() => navigationService.setPageEnabled('campaign', false), 'NO_AVAILABLE_PAGE');
assert.strictEqual(navigationService.snapshot(), lastPageBeforeDisable);

// Constructor copies external inputs; returned snapshots and nested data cannot mutate the service.
const externalInitial = {
  page: 'cards',
  enabledPages: ['home', 'cards'],
  history: ['home'],
  resources: { silver: { value: 777, max: 1_000 } },
};
const isolated = new ShellService({ initial: externalInitial });
externalInitial.page = 'home';
externalInitial.enabledPages.push('hero');
externalInitial.resources.silver.value = 0;
assert.equal(isolated.snapshot().page, 'cards');
assert.equal(isolated.resource('silver').value, 777);
assert.equal(isolated.snapshot().navigation.find(({ id }) => id === 'hero').enabled, false);
const frozenSnapshot = isolated.snapshot();
assert.equal(Object.isFrozen(frozenSnapshot), true);
assert.equal(Object.isFrozen(frozenSnapshot.resources), true);
assert.equal(Object.isFrozen(frozenSnapshot.resources[0]), true);
assert.equal(Object.isFrozen(frozenSnapshot.navigation[0]), true);
assert.throws(() => { frozenSnapshot.page = 'home'; }, TypeError);
assert.throws(() => { frozenSnapshot.resources[0].value = 0; }, TypeError);
assert.throws(() => { frozenSnapshot.resources.push({}); }, TypeError);
assert.equal(isolated.snapshot().page, 'cards');
assert.equal(isolated.snapshot().resources[1].value, 777);

// Persistence is deterministic, restores a detached state, and does not commit when persistence fails.
const persisted = [];
const saving = new ShellService({ persist: (serialized) => persisted.push(serialized) });
saving.setResource('silver', 12_999);
saving.navigate('campaign');
const saved = saving.save();
assert.equal(saved, persisted.at(-1));
const restored = ShellService.fromSerialized(saved);
assert.deepEqual(restored.snapshot(), saving.snapshot());
const savedObject = JSON.parse(saved);
savedObject.resources[1].value = 1;
assert.equal(restored.resource('silver').value, 12_999);
assert.equal(restored.serialize(), saved);
let persistenceCalls = 0;
const failingPersistence = new ShellService({ persist: () => { persistenceCalls += 1; throw new Error('storage unavailable'); } });
const beforePersistenceFailure = failingPersistence.snapshot();
assert.throws(() => failingPersistence.setResource('silver', 99), /storage unavailable/);
assert.strictEqual(failingPersistence.snapshot(), beforePersistenceFailure);
assert.equal(persistenceCalls, 1);

// Synchronous persistence re-entry is serialized: inner mutations are replayed
// after the outer payload succeeds, so the final payload cannot be stale.
const assertReentrantSave = (outerMutation, innerMutation, checkFinal) => {
  const payloads = [];
  let service;
  service = new ShellService({ persist: (serialized) => {
    payloads.push(serialized);
    if (payloads.length === 1) innerMutation(service);
  } });
  outerMutation(service);
  checkFinal(service);
  assert.equal(payloads.length, 2, 'reentrant mutation must be persisted after the outer payload');
  assert.equal(payloads.at(-1), service.serialize(), 'latest persistence payload must match final state');
  assert.notEqual(payloads.at(-1), payloads[0], 'reentrant mutation must not leave the outer payload last');
};

assertReentrantSave(
  (shell) => shell.setResource('crystal', 501),
  (shell) => shell.setResource('silver', 12_999),
  (shell) => {
    assert.equal(shell.resource('crystal').value, 501);
    assert.equal(shell.resource('silver').value, 12_999);
  },
);
assertReentrantSave(
  (shell) => shell.navigate('campaign'),
  (shell) => shell.selectPage('cards'),
  (shell) => {
    assert.equal(shell.snapshot().page, 'cards');
    assert.deepEqual(shell.snapshot().history, ['home', 'campaign']);
  },
);
assertReentrantSave(
  (shell) => shell.navigate('campaign'),
  (shell) => shell.back(),
  (shell) => {
    assert.equal(shell.snapshot().page, 'home');
    assert.deepEqual(shell.snapshot().history, []);
  },
);
const restoredReentrantState = new ShellService({
  initial: { page: 'tasks', resources: { silver: 77, crystal: 901 } },
}).serialize();
assertReentrantSave(
  (shell) => shell.setResource('crystal', 501),
  (shell) => shell.restore(restoredReentrantState),
  (shell) => {
    assert.equal(shell.snapshot().page, 'tasks');
    assert.equal(shell.resource('silver').value, 77);
    assert.equal(shell.resource('crystal').value, 901);
  },
);
const saveReentrantPayloads = [];
let saveReentrantService;
saveReentrantService = new ShellService({ persist: (serialized) => {
  saveReentrantPayloads.push(serialized);
  if (saveReentrantPayloads.length === 1) saveReentrantService.setResource('silver', 12_999);
} });
const saveReentrantInitial = saveReentrantService.serialize();
assert.equal(saveReentrantService.save(), saveReentrantInitial);
assert.equal(saveReentrantService.resource('silver').value, 12_999);
assert.equal(saveReentrantPayloads.length, 2);
assert.equal(saveReentrantPayloads.at(-1), saveReentrantService.serialize(), 'save re-entry must flush the latest payload');

const restoreSavePayloads = [];
let restoreSaveService;
restoreSaveService = new ShellService({ persist: (serialized) => {
  restoreSavePayloads.push(serialized);
  if (restoreSavePayloads.length === 1) restoreSaveService.restore(restoreSaveService.save());
} });
assert.equal(restoreSaveService.setResource('crystal', 501), true);
assert.equal(restoreSaveService.resource('crystal').value, 501);
assert.equal(JSON.parse(restoreSavePayloads.at(-1)).resources.find(({ id }) => id === 'crystal').value, 501);
assert.equal(restoreSavePayloads.at(-1), restoreSaveService.serialize(), 'restore(save()) must preserve the latest payload');

// If the outer persistence fails, queued inner mutations are discarded with it.
let reentrantFailureService;
const beforeReentrantFailure = new ShellService().snapshot();
const reentrantFailure = new ShellService({ persist: () => {
  reentrantFailureService.setResource('silver', 99);
  throw new Error('storage unavailable');
} });
reentrantFailureService = reentrantFailure;
const failureSnapshot = reentrantFailure.snapshot();
assert.throws(() => reentrantFailure.setResource('crystal', 501), /storage unavailable/);
assert.strictEqual(reentrantFailure.snapshot(), failureSnapshot);
assert.deepEqual(failureSnapshot, beforeReentrantFailure);

// Hostile saves and initial states are rejected rather than silently resetting or partially applying.
const invalidSaves = [
  ['', 'INVALID_SAVE'],
  ['not-json', 'INVALID_SAVE'],
  ['{}', 'INVALID_SAVE'],
  [saved.replace('"schemaVersion":1', '"schemaVersion":2'), 'SAVE_VERSION'],
  [saved.replace('"page":"campaign"', '"page":"missing"'), 'PAGE_NOT_FOUND'],
  [saved.replace('"enabled":true', '"enabled":"yes"'), 'INVALID_BOOLEAN'],
  [saved.replace('"value":12999', '"value":-1'), 'INVALID_NUMBER'],
  [saved.replace('"max":null', '"max":0'), 'INVALID_NUMBER'],
  [saved.replace('"id":"home"', '"id":"missing"'), 'INVALID_SAVE'],
  [saved.replace('"resources":[', '"resources":[{"id":"extra","value":1,"max":null},'), 'INVALID_SAVE'],
];
for (const [serialized, code] of invalidSaves) expectError(() => ShellService.fromSerialized(serialized), code);
const disabledPageSave = JSON.parse(saved);
disabledPageSave.navigation.find(({ id }) => id === 'campaign').enabled = false;
expectError(() => ShellService.fromSerialized(JSON.stringify(disabledPageSave)), 'PAGE_DISABLED');
const missingStaminaMaxSave = JSON.parse(saved);
missingStaminaMaxSave.resources.find(({ id }) => id === 'stamina').max = null;
expectError(() => ShellService.fromSerialized(JSON.stringify(missingStaminaMaxSave)), 'RESOURCE_LIMIT');
const invalidInitials = [
  [{ page: 'missing' }, 'PAGE_NOT_FOUND'],
  [{ enabledPages: [] }, 'NO_AVAILABLE_PAGE'],
  [{ enabledPages: ['home', 'home'] }, 'INVALID_ARGUMENT'],
  [{ resources: { silver: -1 } }, 'INVALID_NUMBER'],
  [{ resources: { stamina: { value: 2, max: 1 } } }, 'RESOURCE_LIMIT'],
  [{ resources: { missing: 1 } }, 'RESOURCE_NOT_FOUND'],
  [{ history: 'home' }, 'INVALID_ARGUMENT'],
  [{ resources: { silver: { value: 1, extra: true } } }, 'INVALID_ARGUMENT'],
];
for (const [initial, code] of invalidInitials) expectError(() => new ShellService({ initial }), code);

console.log(`Meta shell contract PASS (${negativeCaseCount} negative cases; deterministic layout/default snapshot, resource and navigation state verified)`);
