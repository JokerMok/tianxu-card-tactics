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

function expectRejected(label, mutate) {
  const candidate = cloneConfig();
  mutate(candidate);
  assert.throws(
    () => loadTowerConfig(candidate, knownUnitIds),
    (error) => error instanceof TowerConfigError,
    `${label} must be rejected by the real tower loader`,
  );
}

expectRejected('missing floor', (candidate) => { candidate.floors.pop(); });
expectRejected('floor below lower boundary', (candidate) => { candidate.floors[0].floor = 0; });
expectRejected('floor above upper boundary', (candidate) => { candidate.floors[49].floor = 51; });
expectRejected('illegal floor boundary', (candidate) => { candidate.floors[0].rules.maxEnemyUnits = 1; });
expectRejected('unknown enemy reference', (candidate) => { candidate.enemyPools[0].unitIds[0] = 'U999'; });
expectRejected('stage enemy pool regression', (candidate) => { candidate.stages[1].enemyPoolId = 'POOL_01'; });
expectRejected('unknown field', (candidate) => { candidate.floors[0].rules.extra = true; });
expectRejected('regressing threat', (candidate) => {
  candidate.floors[25].rules.threatMultiplierPercent = candidate.floors[24].rules.threatMultiplierPercent;
});

console.log(`tower config loaded: ${loaded.floors.length} floors, ${loaded.stages.length} stages, ${loaded.enemyPools.length} enemy pools`);
console.log('progression checks passed: threat, enemy cap, action interval, round limit');
console.log('rejection checks passed: missing floor, boundary, unknown enemy, pool regression, unknown field, regression');
