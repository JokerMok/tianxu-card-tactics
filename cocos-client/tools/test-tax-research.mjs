import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TaxResearchConfigError,
  calculateDailyTax,
  claimDailyTax,
  createInitialTaxResearchState,
  deserializeTaxResearchState,
  enqueueResearch,
  getResearchEffects,
  loadTaxResearchConfig,
  serializeTaxResearchState,
  settleTaxResearchQueue,
} from '../assets/scripts/meta/buildings/tax-research/index.ts';
import { loadBuildingConfig } from '../assets/scripts/meta/buildings/index.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildingRoot = join(projectRoot, 'assets/scripts/meta/buildings');
const taxResearchRoot = join(buildingRoot, 'tax-research');
const buildingConfig = loadBuildingConfig(JSON.parse(readFileSync(join(buildingRoot, 'building-config.json'), 'utf8')), 'building-config.json');
const rawConfig = JSON.parse(readFileSync(join(taxResearchRoot, 'tax-research-config.json'), 'utf8'));
const config = loadTaxResearchConfig(rawConfig, buildingConfig, 'tax-research-config.json');

function expectConfigFailure(label, action, pathPart) {
  assert.throws(action, (error) => error instanceof TaxResearchConfigError && error.configPath.includes(pathPart), `${label} must fail`);
}

function failed(result, code) {
  assert.equal(result.accepted, false);
  assert.equal(result.code, code);
  return result;
}

function resources(silver = 10000, crystal = 200) {
  return { silver, crystal };
}

function buildingLevels(overrides = {}) {
  return Object.fromEntries(buildingConfig.buildings.map((building) => [building.id, overrides[building.id] ?? building.initialLevel]));
}

function initialState(overrides = {}, resourceValues = resources(), atMs = 0) {
  return createInitialTaxResearchState(config, buildingLevels(overrides), resourceValues, atMs);
}

function checkSkeletonAndDiff() {
  const required = ['TaxResearchConfig.ts', 'TaxResearchQueue.ts', 'index.ts', 'tax-research-config.json'];
  for (const file of required) assert.equal(statSync(join(taxResearchRoot, file)).isFile(), true, `${file} is required`);
  const assertSkeleton = (entries) => {
    if (entries.slice().sort().join('|') !== required.slice().sort().join('|')) throw new Error('tax research module skeleton contains an unexpected file');
  };
  assertSkeleton(readdirSync(taxResearchRoot));
  assert.throws(() => assertSkeleton([...required, 'unexpected.ts']), /unexpected file/, 'skeleton negative case must fail');
  for (const file of ['TaxResearchConfig.ts', 'TaxResearchQueue.ts', 'index.ts']) {
    const source = readFileSync(join(taxResearchRoot, file), 'utf8');
    assert.equal(/TODO|placeholder|Date\.now|Math\.random/.test(source), false, `${file} must not contain non-deterministic or placeholder logic`);
  }

  const allowed = new Set(['cocos-client/assets/scripts/meta/buildings/tax-research', 'cocos-client/tools/test-tax-research.mjs']);
  const baselineCommit = process.env.T235_BASE_COMMIT ?? '35f20ca';
  const targetCommit = process.env.T235_TARGET_COMMIT ?? 'HEAD';
  const trackedChanges = execFileSync(
    'git',
    ['diff', '--name-only', `${baselineCommit}..${targetCommit}`],
    { cwd: resolve(projectRoot, '..'), encoding: 'utf8' },
  ).split('\n').map((line) => line.trim()).filter(Boolean);
  const assertAllowedDiff = (paths) => {
    for (const path of paths) {
      if (![...allowed].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) throw new Error(`out-of-scope tracked diff: ${path}`);
    }
  };
  assertAllowedDiff(trackedChanges);
  assert.throws(() => assertAllowedDiff(['cocos-client/assets/scripts/meta/other/Unexpected.ts']), /out-of-scope tracked diff/, 'diff negative case must fail');
}

function checkConfigLoadingAndCrossTables() {
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.buildingConfigId, buildingConfig.id);
  assert.deepEqual(config.tax.tiers.map(({ castleLevel }) => castleLevel), [1, 2, 3, 4, 5]);
  assert.deepEqual(config.researches.map(({ id }) => id), ['alchemy-success', 'forge-success', 'construction-speed']);
  assert.equal(config.researchQueue.maxEntries, 2);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.tax.tiers[0].payouts[0]), true);

  const unknownTaxResource = structuredClone(rawConfig);
  unknownTaxResource.tax.tiers[0].payouts[0].resourceId = 'gold';
  expectConfigFailure('unknown tax resource', () => loadTaxResearchConfig(unknownTaxResource, buildingConfig, 'fixture'), 'fixture.tax.tiers[0].payouts[0].resourceId');

  const overCap = structuredClone(rawConfig);
  overCap.tax.tiers[0].payouts[0].dailyAmount = overCap.tax.tiers[0].payouts[0].dailyCap + 1;
  expectConfigFailure('tax amount above cap', () => loadTaxResearchConfig(overCap, buildingConfig, 'fixture'), 'fixture.tax.tiers[0].payouts[0].dailyAmount');

  const unknownBuilding = structuredClone(rawConfig);
  unknownBuilding.researches[0].upgrades[0].prerequisites[0].buildingId = 'missing';
  expectConfigFailure('unknown research building prerequisite', () => loadTaxResearchConfig(unknownBuilding, buildingConfig, 'fixture'), 'fixture.researches[0].upgrades[0].prerequisites[0].buildingId');

  const impossibleBuilding = structuredClone(rawConfig);
  impossibleBuilding.researches[0].upgrades[0].prerequisites[0].requiredLevel = 99;
  expectConfigFailure('research building prerequisite above max', () => loadTaxResearchConfig(impossibleBuilding, buildingConfig, 'fixture'), 'requiredLevel');

  const unknownResearch = structuredClone(rawConfig);
  unknownResearch.researches[2].upgrades[0].prerequisites[1].researchId = 'missing';
  expectConfigFailure('unknown research prerequisite', () => loadTaxResearchConfig(unknownResearch, buildingConfig, 'fixture'), 'researchId');

  const unknownEffect = structuredClone(rawConfig);
  unknownEffect.researches[0].upgrades[0].effects[0].effectId = 'GUILD_SUCCESS_RATE_BPS';
  expectConfigFailure('unmigrated guild effect', () => loadTaxResearchConfig(unknownEffect, buildingConfig, 'fixture'), 'effectId');

  const incompleteResearch = structuredClone(rawConfig);
  incompleteResearch.researches[0].upgrades.pop();
  expectConfigFailure('incomplete research table', () => loadTaxResearchConfig(incompleteResearch, buildingConfig, 'fixture'), 'upgrades');
}

function checkTaxSuccessFailureAndBoundaries() {
  const initial = initialState();
  const first = claimDailyTax(initial, config, 0, 0);
  assert.equal(first.code, 'TAX_CLAIMED');
  assert.deepEqual(first.tax, { silver: 250, crystal: 5 });
  assert.deepEqual(first.state.resources, { silver: 10250, crystal: 205 });
  assert.equal(first.state.lastTaxClaimDay, 0);

  const duplicate = failed(claimDailyTax(first.state, config, 0, 100), 'TAX_ALREADY_CLAIMED');
  assert.deepEqual(duplicate.state, first.state, 'duplicate claim rolls back queue settlement and clock');
  failed(claimDailyTax(first.state, config, -1, 100), 'INVALID_DAY');
  failed(claimDailyTax(first.state, config, Number.MAX_SAFE_INTEGER + 1, 100), 'INVALID_DAY');
  failed(claimDailyTax(first.state, config, 0, 100), 'TAX_ALREADY_CLAIMED');
  failed(claimDailyTax(first.state, config, -1, 0), 'INVALID_DAY');

  const levelFive = initialState({ castle: 5 }, resources(0, 0));
  assert.deepEqual(calculateDailyTax(config, 5), { silver: 1000, crystal: 20 });
  assert.deepEqual(claimDailyTax(levelFive, config, 3, 0).state.resources, { silver: 1000, crystal: 20 }, 'castle level selects tax tier');

  const nearLimit = initialState({}, { silver: Number.MAX_SAFE_INTEGER - 100, crystal: 0 });
  failed(claimDailyTax(nearLimit, config, 0, 0), 'INVALID_TIME');
  assert.equal(nearLimit.lastTaxClaimDay, null, 'overflow failure does not mark tax day claimed');
}

function checkResearchSuccessFailureAndBoundaries() {
  const blocked = initialState({ castle: 1, alchemy: 1, forge: 1 });
  failed(enqueueResearch(blocked, config, 'alchemy-success', 0), 'PREREQUISITE_MISSING');
  failed(enqueueResearch(blocked, config, 'missing', 0), 'UNKNOWN_RESEARCH');

  const ready = initialState({ castle: 3, alchemy: 3, forge: 2 }, resources());
  const first = enqueueResearch(ready, config, 'alchemy-success', 0);
  assert.equal(first.code, 'RESEARCH_ENQUEUED');
  assert.equal(first.entry.id, 'alchemy-success:L1:Q1');
  assert.equal(first.entry.finishAtMs, 20000);
  assert.deepEqual(first.state.resources, { silver: 9100, crystal: 180 });
  assert.equal(first.state.researchLevels['alchemy-success'], 0, 'research level changes only after completion');

  const duplicate = failed(enqueueResearch(first.state, config, 'alchemy-success', 100), 'RESEARCH_BUSY');
  assert.deepEqual(duplicate.state, first.state, 'failed enqueue is atomic across settlement');

  const before = settleTaxResearchQueue(first.state, config, 19999);
  assert.deepEqual(before.completedEntryIds, []);
  assert.equal(before.state.researchLevels['alchemy-success'], 0);
  const completed = settleTaxResearchQueue(first.state, config, 20000);
  assert.deepEqual(completed.completedEntryIds, [first.entry.id]);
  assert.equal(completed.state.researchLevels['alchemy-success'], 1);
  assert.deepEqual(getResearchEffects(completed.state, config), { ALCHEMY_SUCCESS_RATE_BPS: 500 });

  const second = enqueueResearch(completed.state, config, 'alchemy-success', 20000);
  assert.equal(second.entry.id, 'alchemy-success:L2:Q2');
  assert.equal(second.entry.startAtMs, 20000);
  const secondDone = settleTaxResearchQueue(second.state, config, 60000);
  assert.equal(secondDone.state.researchLevels['alchemy-success'], 2);
  assert.deepEqual(getResearchEffects(secondDone.state, config), { ALCHEMY_SUCCESS_RATE_BPS: 1500 });
  failed(enqueueResearch(secondDone.state, config, 'alchemy-success', 60000), 'MAX_LEVEL');

  const queueState = initialState({ castle: 3, alchemy: 3, forge: 2 }, resources(10000, 200));
  const queuedAlchemy = enqueueResearch(queueState, config, 'alchemy-success', 0);
  const queuedForge = enqueueResearch(queuedAlchemy.state, config, 'forge-success', 0);
  assert.equal(queuedForge.state.queue.length, 2);
  failed(enqueueResearch(queuedForge.state, config, 'construction-speed', 0), 'RESEARCH_QUEUE_FULL');

  const poor = initialState({ castle: 3, alchemy: 3, forge: 2 }, resources(899, 20));
  failed(enqueueResearch(poor, config, 'alchemy-success', 0), 'INSUFFICIENT_RESOURCES');
  const exact = initialState({ castle: 2, alchemy: 1, forge: 1 }, resources(900, 20));
  assert.equal(enqueueResearch(exact, config, 'alchemy-success', 0).accepted, true, 'exact research resources are sufficient');

  failed(settleTaxResearchQueue(ready, config, 0 - 1), 'INVALID_TIME');
  const advanced = settleTaxResearchQueue(first.state, config, 1);
  const rewind = settleTaxResearchQueue(advanced.state, config, 0);
  failed(rewind, 'TIME_REWIND');
  const nearIntegerLimit = initialState({ castle: 2, alchemy: 1, forge: 1 }, resources(), Number.MAX_SAFE_INTEGER - 1);
  failed(enqueueResearch(nearIntegerLimit, config, 'alchemy-success', Number.MAX_SAFE_INTEGER - 1), 'INVALID_TIME');

  const serialized = serializeTaxResearchState(first.state, config);
  assert.deepEqual(deserializeTaxResearchState(serialized, config), first.state, 'research state round-trips through JSON');
  assert.equal(serialized, serializeTaxResearchState(deserializeTaxResearchState(serialized, config), config), 'serialization is canonical');
  const extraSnapshotKey = JSON.parse(serialized);
  extraSnapshotKey.extra = true;
  assert.throws(() => deserializeTaxResearchState(JSON.stringify(extraSnapshotKey), config), /tax research state shape is invalid/);

  const run = () => {
    let state = initialState({ castle: 3, alchemy: 3, forge: 2 }, resources());
    state = enqueueResearch(state, config, 'alchemy-success', 0).state;
    return serializeTaxResearchState(settleTaxResearchQueue(state, config, 20000).state, config);
  };
  assert.equal(run(), run(), 'same inputs produce the same research snapshot');
}

function checkInvalidStateIsFailClosed() {
  const invalidNull = settleTaxResearchQueue(null, config, 0);
  failed(invalidNull, 'INVALID_STATE');
  assert.equal(invalidNull.state, null);
  const invalidShape = claimDailyTax({ schemaVersion: 1 }, config, 0, 0);
  failed(invalidShape, 'INVALID_STATE');
  assert.equal(invalidShape.state, null);
}

checkSkeletonAndDiff();
checkConfigLoadingAndCrossTables();
checkTaxSuccessFailureAndBoundaries();
checkResearchSuccessFailureAndBoundaries();
checkInvalidStateIsFailClosed();
console.log('T235 tax/research: config load/cross-table, tax tiers/caps, queue prerequisites, success/failure/boundary, atomic rollback, serialization, skeleton and diff checks PASS');
