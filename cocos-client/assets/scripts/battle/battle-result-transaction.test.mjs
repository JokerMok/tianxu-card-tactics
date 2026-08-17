import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BattleExitTransactionPort,
  BattleResultTransactionPort,
  BattleResultTransactionService,
} from './battle-result-transaction.ts';
import { createBattleResultState } from '../services/BattleResultTransactionService.ts';
import { BattleExitController } from './battle-exit-controller.ts';

const source = fs.readFileSync(new URL('./battle-result-transaction.ts', import.meta.url), 'utf8');
const serviceSource = fs.readFileSync(new URL('../services/BattleResultTransactionService.ts', import.meta.url), 'utf8');
for (const candidate of [source, serviceSource]) {
  assert.doesNotMatch(candidate, /(?:from|require\()\s*["']node:/, 'transaction code must be runtime-neutral');
  assert.doesNotMatch(candidate, /\b(?:window|document|cc|React|setTimeout|setInterval|Date)\b/, 'transaction code must not require a host runtime');
  assert.match(candidate, /Object\.freeze/, 'transaction snapshots must be frozen');
}

function state() {
  return createBattleResultState(
    { gold: 10, essence: 3 },
    { clearedNodes: [], unlockedNodes: ['N001'] },
  );
}

function result(overrides = {}) {
  return {
    businessKey: 'battle:N001:1',
    nodeId: 'N001',
    cost: { gold: 2 },
    outcome: { kind: 'victory', details: { rounds: 3 } },
    reward: { gold: 5, essence: 1 },
    progress: { clearedNodes: ['N001'], unlockedNodes: ['N002'] },
    ...overrides,
  };
}

function hostile(template, trap) {
  return new Proxy(template, {
    [trap]() { throw new Error(`${trap} failed`); },
  });
}

// One immutable intent produces one atomic persisted state. Later mutation of the
// caller object cannot affect it, and every published state is the exact committed reference.
{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const port = new BattleResultTransactionPort(service);
  const template = result();
  const committed = port.settle(template);
  assert.deepEqual({ accepted: committed.accepted, applied: committed.applied, code: committed.code }, {
    accepted: true, applied: true, code: 'APPLIED',
  });
  assert.equal(saved.length, 1);
  assert.strictEqual(saved[0], committed.state);
  assert.strictEqual(saved[0], service.snapshot);
  assert.equal(Object.isFrozen(saved[0]), true);
  assert.equal(Object.isFrozen(saved[0].resources), true);
  assert.equal(Object.isFrozen(saved[0].progress), true);
  assert.equal(Object.isFrozen(saved[0].battleOutcomes['battle:N001:1']), true);
  template.cost.gold = 9;
  template.reward.gold = 99;
  template.progress.clearedNodes.push('N999');
  template.outcome.details.rounds = 99;
  assert.deepEqual(service.snapshot, {
    resources: { gold: 13, essence: 4 },
    progress: { clearedNodes: ['N001'], unlockedNodes: ['N001', 'N002'] },
    battleOutcomes: { 'battle:N001:1': { kind: 'victory', details: { rounds: 3 } } },
    processedBattleKeys: { 'battle:N001:1': service.snapshot.processedBattleKeys['battle:N001:1'] },
  });
}

// Accessors and every required hostile Proxy trap reject before persistence.
for (const candidate of [
  hostile(result(), 'get'),
  hostile(result(), 'ownKeys'),
  hostile(result(), 'getOwnPropertyDescriptor'),
]) {
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  assert.equal(new BattleResultTransactionPort(service).settle(candidate).code, 'INVALID');
  assert.equal(saved.length, 0);
  assert.deepEqual(service.snapshot, state());
}

{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const changing = result();
  let reads = 0;
  Object.defineProperty(changing, 'nodeId', {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? 'N001' : 'N999'; },
  });
  assert.equal(new BattleResultTransactionPort(service).settle(changing).code, 'INVALID');
  assert.equal(reads, 0, 'accessors are rejected without executing them');
  assert.equal(saved.length, 0);
}

// A valid Proxy is read once per external data field; nested hostile values are
// rejected before any resource, progress or processed-key change.
{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const counts = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0 };
  const template = new Proxy(result({ businessKey: 'battle:N001:counted' }), {
    get(target, key, receiver) { counts.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { counts.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { counts.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  assert.equal(new BattleResultTransactionPort(service).settle(template).code, 'APPLIED');
  assert.deepEqual(counts, { get: 6, ownKeys: 1, getOwnPropertyDescriptor: 6 });
  assert.equal(saved.length, 1);
}

{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const template = result({ businessKey: 'battle:N001:nested-counted' });
  const counts = { cost: 0, reward: 0, progress: 0, outcome: 0 };
  for (const field of Object.keys(counts)) {
    template[field] = new Proxy(template[field], {
      get(target, key, receiver) { counts[field] += 1; return Reflect.get(target, key, receiver); },
    });
  }
  assert.equal(new BattleResultTransactionPort(service).settle(template).code, 'APPLIED');
  assert.deepEqual(counts, { cost: 1, reward: 2, progress: 2, outcome: 2 });
  assert.equal(saved.length, 1);
}

for (const field of ['cost', 'reward', 'progress', 'outcome']) {
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const template = result({ businessKey: `battle:N001:nested-${field}` });
  const original = template[field];
  template[field] = hostile(original, 'get');
  assert.equal(new BattleResultTransactionPort(service).settle(template).code, 'INVALID', `${field} get trap must reject`);
  assert.equal(saved.length, 0);
}

{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const port = new BattleResultTransactionPort(service);
  assert.equal(port.settle(result()).code, 'APPLIED');
  assert.equal(port.settle(result()).code, 'DUPLICATE');
  assert.equal(port.settle(result({ reward: { gold: 6, essence: 1 } })).code, 'CONFLICT');
  assert.equal(saved.length, 1, 'duplicates and conflicts must not persist');
}

// Failed persistence and synchronous re-entry cannot leak a partial transaction.
{
  const service = new BattleResultTransactionService(state(), () => { throw new Error('disk unavailable'); });
  const before = service.snapshot;
  const failed = service.settle(result());
  assert.equal(failed.code, 'PERSIST_FAILED');
  assert.strictEqual(failed.state, before);
  assert.strictEqual(service.snapshot, before);
}

{
  const saved = [];
  let reentrant;
  let service;
  service = new BattleResultTransactionService(state(), (next) => {
    saved.push(next);
    reentrant = service.settle(result({ businessKey: 'battle:N002:1', nodeId: 'N002' }));
  });
  assert.equal(service.settle(result()).code, 'APPLIED');
  assert.equal(reentrant.code, 'REENTRANT');
  assert.equal(saved.length, 1);
  assert.deepEqual(Object.keys(service.snapshot.processedBattleKeys), ['battle:N001:1']);
}

// Exit settlement snapshots its template first, shares the service transaction and grants no reward.
{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const exit = new BattleExitTransactionPort(service, {
    businessKey: 'battle:N001:exit',
    nodeId: 'N001',
    cost: { gold: 2 },
    outcome: { kind: 'ignored-template-outcome' },
    reward: { gold: 999 },
    progress: { clearedNodes: [], unlockedNodes: [] },
  });
  const controller = new BattleExitController({ port: exit });
  assert.equal(controller.requestSurrender().accepted, true);
  assert.equal(controller.confirm().code, 'SETTLED');
  assert.equal(saved.length, 1);
  assert.equal(service.snapshot.resources.gold, 8, 'exit applies its entry cost but never template rewards');
  assert.deepEqual(service.snapshot.battleOutcomes['battle:N001:exit'], { kind: 'exit', reason: 'surrender' });
  assert.equal(exit.settle({ reason: 'surrender' }).code, 'DUPLICATE');
  assert.equal(exit.settle({ reason: 'abnormal' }).code, 'CONFLICT');
  assert.equal(saved.length, 1);
}

{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const exit = new BattleExitTransactionPort(service, {
    businessKey: 'battle:N002:exit-minimal',
    nodeId: 'N002',
    cost: {},
    progress: { clearedNodes: [], unlockedNodes: [] },
  });
  assert.equal(exit.settle({ reason: 'abnormal' }).code, 'APPLIED');
  assert.deepEqual(service.snapshot.battleOutcomes['battle:N002:exit-minimal'], { kind: 'exit', reason: 'abnormal' });
  assert.equal(saved.length, 1);
}

for (const template of [
  hostile(result({ businessKey: 'battle:N001:hostile-exit' }), 'get'),
  hostile(result({ businessKey: 'battle:N001:hostile-exit' }), 'ownKeys'),
  hostile(result({ businessKey: 'battle:N001:hostile-exit' }), 'getOwnPropertyDescriptor'),
]) {
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const exit = new BattleExitTransactionPort(service, template);
  assert.equal(exit.settle({ reason: 'surrender' }).code, 'INVALID');
  assert.equal(saved.length, 0);
  assert.equal(service.snapshot.resources.gold, 10);
}

{
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const template = result({ businessKey: 'battle:N001:getter-exit' });
  let reads = 0;
  Object.defineProperty(template, 'nodeId', {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? 'N001' : 'N999'; },
  });
  const exit = new BattleExitTransactionPort(service, template);
  assert.equal(exit.settle({ reason: 'surrender' }).code, 'INVALID');
  assert.equal(reads, 0);
  assert.equal(saved.length, 0);
}

for (const trap of ['get', 'ownKeys', 'getOwnPropertyDescriptor']) {
  const saved = [];
  const service = new BattleResultTransactionService(state(), (next) => saved.push(next));
  const template = result({ businessKey: `battle:N001:exit-nested-${trap}` });
  template.progress = hostile(template.progress, trap);
  const exit = new BattleExitTransactionPort(service, template);
  assert.equal(exit.settle({ reason: 'surrender' }).code, 'INVALID');
  assert.equal(saved.length, 0);
  assert.deepEqual(service.snapshot, state());
}

console.log('T122 battle result transaction PASS: defensive snapshots, atomic persistence and exit settlement');
