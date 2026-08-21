import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyBuildingSpeedup,
  BuildingConfigError,
  createInitialBuildingQueueState,
  deserializeBuildingQueueState,
  enqueueBuildingUpgrade,
  loadBuildingConfig,
  serializeBuildingQueueState,
  settleBuildingQueue,
} from '../assets/scripts/meta/buildings/index.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildingRoot = join(projectRoot, 'assets/scripts/meta/buildings');
const config = loadBuildingConfig(JSON.parse(readFileSync(join(buildingRoot, 'building-config.json'), 'utf8')), 'building-config.json');

function expectFailure(label, action, codeOrPattern) {
  assert.throws(action, (error) => {
    if (codeOrPattern instanceof RegExp) return codeOrPattern.test(String(error));
    return error instanceof BuildingConfigError && error.configPath.includes(codeOrPattern);
  }, `${label} must fail`);
}

function failed(result, code) {
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  return result;
}

function resources(silver = 20000, crystal = 1000) {
  return { silver, crystal };
}

function checkSkeletonAndDiff() {
  const required = ['BuildingConfig.ts', 'BuildingQueue.ts', 'building-config.json', 'index.ts'];
  for (const file of required) assert.equal(statSync(join(buildingRoot, file)).isFile(), true, `${file} is required`);
  assert.deepEqual(readdirSync(buildingRoot).sort(), required.sort(), 'building module must contain only the approved skeleton files');
  for (const file of ['BuildingConfig.ts', 'BuildingQueue.ts', 'index.ts']) {
    const source = readFileSync(join(buildingRoot, file), 'utf8');
    assert.equal(/TODO|placeholder|Date\.now|Math\.random/.test(source), false, `${file} must not contain non-deterministic or placeholder logic`);
  }

  const allowed = new Set(['cocos-client/assets/scripts/meta/buildings', 'cocos-client/tools/test-building-queue.mjs']);
  const trackedChanges = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: resolve(projectRoot, '..'), encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).filter(Boolean);
  for (const path of trackedChanges) assert.equal([...allowed].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)), true, `out-of-scope tracked diff: ${path}`);
}

function checkConfigLoadingAndCrossTables() {
  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(config.buildings.map(({ id }) => id), ['castle', 'alchemy', 'forge', 'harbor']);
  assert.equal(config.queue.maxEntries, 3);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.buildings[0]), true);

  const unknownResource = JSON.parse(JSON.stringify(config));
  unknownResource.buildings[0].upgrades[0].cost.gold = 1;
  expectFailure('unknown cost resource', () => loadBuildingConfig(unknownResource, 'fixture'), 'fixture.buildings[0].upgrades[0].cost.gold');

  const unknownPrerequisite = JSON.parse(JSON.stringify(config));
  unknownPrerequisite.buildings[1].upgrades[0].prerequisites[0].buildingId = 'missing';
  expectFailure('unknown prerequisite building', () => loadBuildingConfig(unknownPrerequisite, 'fixture'), 'fixture.buildings[1].upgrades[0].prerequisites[0].buildingId');

  const impossiblePrerequisite = JSON.parse(JSON.stringify(config));
  impossiblePrerequisite.buildings[1].upgrades[0].prerequisites[0].requiredLevel = 99;
  expectFailure('prerequisite above referenced max level', () => loadBuildingConfig(impossiblePrerequisite, 'fixture'), 'requiredLevel');

  const missingUpgrade = JSON.parse(JSON.stringify(config));
  missingUpgrade.buildings[0].upgrades.pop();
  expectFailure('incomplete upgrade table', () => loadBuildingConfig(missingUpgrade, 'fixture'), 'upgrades');
}

function checkSuccessFailureAndBoundaries() {
  const initial = createInitialBuildingQueueState(config, resources(), 1000);
  const started = enqueueBuildingUpgrade(initial, config, 'castle', 1000);
  assert.equal(started.code, 'ENQUEUED');
  assert.equal(started.entry.finishAtMs, 31000);
  assert.deepEqual(started.state.resources, { silver: 18600, crystal: 960 });
  assert.equal(started.state.buildingLevels.castle, 1, 'level changes only after completion');

  const duplicateBuilding = enqueueBuildingUpgrade(started.state, config, 'castle', 1000);
  failed(duplicateBuilding, 'BUILDING_BUSY');
  assert.deepEqual(duplicateBuilding.state.resources, started.state.resources, 'failed enqueue does not double-charge');

  const queued = enqueueBuildingUpgrade(started.state, config, 'alchemy', 1000);
  assert.equal(queued.code, 'ENQUEUED');
  assert.equal(queued.entry.startAtMs, 31000);
  assert.equal(queued.entry.finishAtMs, 56000);
  const third = enqueueBuildingUpgrade(queued.state, config, 'forge', 1000);
  assert.equal(third.code, 'ENQUEUED');
  failed(enqueueBuildingUpgrade(third.state, config, 'harbor', 1000), 'QUEUE_FULL');

  const beforeCastle = settleBuildingQueue(third.state, config, 30999);
  assert.deepEqual(beforeCastle.completedEntryIds, []);
  assert.equal(beforeCastle.state.buildingLevels.castle, 1);
  const afterCastle = settleBuildingQueue(third.state, config, 31000);
  assert.deepEqual(afterCastle.completedEntryIds, [started.entry.id]);
  assert.equal(afterCastle.state.buildingLevels.castle, 2);
  const offline = settleBuildingQueue(third.state, config, 200000);
  assert.deepEqual(offline.completedEntryIds, [started.entry.id, queued.entry.id, third.entry.id]);
  assert.deepEqual(offline.state.buildingLevels, { castle: 2, alchemy: 2, forge: 2, harbor: 1 });

  const prereqBlocked = enqueueBuildingUpgrade(initial, config, 'harbor', 1000);
  failed(prereqBlocked, 'PREREQUISITE_MISSING');
  const poor = createInitialBuildingQueueState(config, { silver: 1399, crystal: 40 }, 0);
  failed(enqueueBuildingUpgrade(poor, config, 'castle', 0), 'INSUFFICIENT_RESOURCES');
  const exact = createInitialBuildingQueueState(config, { silver: 1400, crystal: 40 }, 0);
  assert.equal(enqueueBuildingUpgrade(exact, config, 'castle', 0).accepted, true, 'exact resources are sufficient');

  const maxed = createInitialBuildingQueueState(config, resources(), 0);
  maxed.buildingLevels.castle = 5;
  failed(enqueueBuildingUpgrade(maxed, config, 'castle', 0), 'MAX_LEVEL');
  failed(settleBuildingQueue(initial, config, 999), 'TIME_REWIND');
  failed(settleBuildingQueue(initial, config, -1), 'INVALID_TIME');
  const nearIntegerLimit = createInitialBuildingQueueState(config, resources(), Number.MAX_SAFE_INTEGER - 1);
  failed(enqueueBuildingUpgrade(nearIntegerLimit, config, 'castle', Number.MAX_SAFE_INTEGER - 1), 'INVALID_TIME');
}

function checkSpeedupAndSerialization() {
  const initial = createInitialBuildingQueueState(config, resources(), 0);
  const started = enqueueBuildingUpgrade(initial, config, 'castle', 0);
  const boosted = applyBuildingSpeedup(started.state, config, started.entry.id, 9000, 1000);
  assert.equal(boosted.code, 'BOOST_APPLIED');
  assert.equal(boosted.appliedMs, 9000);
  assert.equal(boosted.state.queue[0].finishAtMs, 21000);
  failed(applyBuildingSpeedup(boosted.state, config, started.entry.id, 0, 1000), 'INVALID_BOOST');
  failed(applyBuildingSpeedup(boosted.state, config, 'missing', 1000, 1000), 'ENTRY_NOT_FOUND');

  const serialized = serializeBuildingQueueState(boosted.state, config);
  assert.deepEqual(deserializeBuildingQueueState(serialized, config), boosted.state, 'queue state round-trips through JSON');
  assert.equal(serialized, serializeBuildingQueueState(deserializeBuildingQueueState(serialized, config), config), 'serialization is canonical');

  const run = () => {
    let state = createInitialBuildingQueueState(config, resources(), 0);
    state = enqueueBuildingUpgrade(state, config, 'castle', 0).state;
    state = applyBuildingSpeedup(state, config, state.queue[0].id, 5000, 100).state;
    return serializeBuildingQueueState(settleBuildingQueue(state, config, 25000).state, config);
  };
  assert.equal(run(), run(), 'same inputs produce the same snapshot');
}

checkSkeletonAndDiff();
checkConfigLoadingAndCrossTables();
checkSuccessFailureAndBoundaries();
checkSpeedupAndSerialization();
console.log('T234 building queue: config load/cross-table, success/failure/boundary, speedup/offline completion, serialization, skeleton and diff checks PASS');
