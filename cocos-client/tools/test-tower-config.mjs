import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TOWER_FLOOR_COUNT,
  TOWER_STAGE_SIZE,
  TowerConfigError,
  createTowerConfig,
  loadTowerConfig,
  towerConfig,
} from '../assets/scripts/pve/tower/TowerConfig.ts';

const root = path.resolve(import.meta.dirname, '..');
const unitsPath = path.join(root, 'assets/resources/config/units.json');
const unitsDocument = JSON.parse(fs.readFileSync(unitsPath, 'utf8'));
const knownUnitIds = new Set(unitsDocument.units.map(({ id }) => id));

const loaded = loadTowerConfig(towerConfig, knownUnitIds);
assert.equal(loaded.floorCount, TOWER_FLOOR_COUNT);
assert.equal(loaded.stages.length, TOWER_FLOOR_COUNT / TOWER_STAGE_SIZE);
assert.equal(loaded.floors.length, TOWER_FLOOR_COUNT);
assert.deepEqual(createTowerConfig(), towerConfig, 'tower generation must be deterministic');
assert.deepEqual(
  loadTowerConfig(JSON.parse(JSON.stringify(towerConfig)), knownUnitIds),
  towerConfig,
  'normal JSON config must remain loadable',
);

for (const [index, floor] of loaded.floors.entries()) {
  assert.equal(floor.floor, index + 1, 'floors must be contiguous');
  assert.equal(floor.stageId, loaded.stages[Math.floor(index / TOWER_STAGE_SIZE)].id, 'floor stage must be contiguous');
  assert.equal(floor.enemyIds.length <= floor.rules.maxEnemyUnits, true, 'enemy count must respect the floor cap');
  if (index > 0) {
    const previous = loaded.floors[index - 1];
    assert.equal(floor.rules.threatMultiplierPercent > previous.rules.threatMultiplierPercent, true, 'threat must increase');
    assert.equal(floor.rules.maxEnemyUnits >= previous.rules.maxEnemyUnits, true, 'enemy cap must not decrease');
    assert.equal(floor.rules.enemyActionInterval <= previous.rules.enemyActionInterval, true, 'enemy action interval must not slow down');
    assert.equal(floor.rules.maxRounds <= previous.rules.maxRounds, true, 'round limit must not increase');
  }
}

function cloneConfig() {
  return structuredClone(towerConfig);
}

function expectRejected(label, mutate, expectedConfigPath) {
  const candidate = cloneConfig();
  mutate(candidate);
  assert.throws(
    () => loadTowerConfig(candidate, knownUnitIds),
    (error) => error instanceof TowerConfigError
      && (!expectedConfigPath || error.configPath === expectedConfigPath),
    `${label} must be rejected by the real tower loader`,
  );
}

expectRejected('missing floor', (candidate) => { candidate.floors.pop(); });
expectRejected('floor below lower boundary', (candidate) => { candidate.floors[0].floor = 0; });
expectRejected('floor above upper boundary', (candidate) => { candidate.floors[49].floor = 51; });
expectRejected('illegal floor boundary', (candidate) => { candidate.floors[0].rules.maxEnemyUnits = 1; });
expectRejected('unknown enemy reference', (candidate) => { candidate.enemyPools[0].unitIds[0] = 'U999'; });
expectRejected('stage enemy pool regression', (candidate) => { candidate.stages[1].enemyPoolId = 'POOL_01'; });
expectRejected('flat stage difficulty sequence', (candidate) => {
  candidate.stages.forEach((stage) => { stage.difficulty = 'STANDARD'; });
}, 'config.stages[2].difficulty');
expectRejected('regressing stage special rule sequence', (candidate) => {
  candidate.stages[1].specialRule = candidate.stages[0].specialRule;
  candidate.floors.slice(5, 10).forEach((floor) => { floor.rules.specialRule = candidate.stages[1].specialRule; });
}, 'config.stages[1].specialRule');
expectRejected('homogeneous enemy pools', (candidate) => {
  const sharedUnitIds = [...candidate.enemyPools[0].unitIds];
  candidate.enemyPools.forEach((pool) => { pool.unitIds = [...sharedUnitIds]; });
  candidate.floors.forEach((floor) => { floor.enemyIds = ['U001', 'U002']; });
}, 'config.enemyPools[1].unitIds');
expectRejected('fixed floor enemy combination', (candidate) => {
  candidate.floors.forEach((floor) => { floor.enemyIds = ['U001', 'U002']; });
}, 'config.floors[1].enemyIds');
expectRejected('unknown field', (candidate) => { candidate.floors[0].rules.extra = true; });
expectRejected('non-enumerable unknown field', (candidate) => {
  Object.defineProperty(candidate.floors[0].rules, 'hiddenExtra', { value: true, enumerable: false });
});
expectRejected('unknown symbol field', (candidate) => {
  Object.defineProperty(candidate.floors[0].rules, Symbol('unknown'), { value: true });
});
expectRejected('inherited unknown field', (candidate) => {
  Object.setPrototypeOf(candidate.floors[0].rules, { inheritedExtra: true });
});
expectRejected('inherited required field', (candidate) => {
  delete candidate.floors[0].floor;
  Object.setPrototypeOf(candidate.floors[0], { floor: 1 });
}, 'config.floors[0].__proto__');
expectRejected('custom empty prototype', (candidate) => {
  Object.setPrototypeOf(candidate.floors[0], Object.create(null));
});
expectRejected('custom prototype same-name field', (candidate) => {
  Object.setPrototypeOf(candidate.floors[0], { floor: candidate.floors[0].floor });
});

function expectRejectedForObjectPrototypeMutation(label, mutatePrototype) {
  const candidate = cloneConfig();
  const existingKeys = new Set(Reflect.ownKeys(Object.prototype));
  mutatePrototype();
  try {
    assert.throws(
      () => loadTowerConfig(candidate, knownUnitIds),
      (error) => error instanceof TowerConfigError && error.configPath === 'config.__proto__',
      `${label} must be rejected by the real tower loader`,
    );
  } finally {
    for (const key of Reflect.ownKeys(Object.prototype)) {
      if (!existingKeys.has(key)) delete Object.prototype[key];
    }
  }
}

expectRejectedForObjectPrototypeMutation('legal enumerable Object.prototype pollution', () => {
  Object.prototype.floor = 1;
});
expectRejectedForObjectPrototypeMutation('non-enumerable Object.prototype pollution', () => {
  Object.defineProperty(Object.prototype, '__towerTestHidden', { value: true, enumerable: false, configurable: true });
});
expectRejectedForObjectPrototypeMutation('symbol Object.prototype pollution', () => {
  Object.defineProperty(Object.prototype, Symbol('towerTestPollution'), { value: true, configurable: true });
});
expectRejected('regressing threat', (candidate) => {
  candidate.floors[25].rules.threatMultiplierPercent = candidate.floors[24].rules.threatMultiplierPercent;
});

console.log(`tower config loaded: ${loaded.floors.length} floors, ${loaded.stages.length} stages, ${loaded.enemyPools.length} enemy pools`);
console.log('progression checks passed: threat, enemy cap, action interval, round limit');
console.log('rejection checks passed: missing floor, boundary, unknown enemy, pool/stage progression, enemy variation, unknown field, regression');
