import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILD_TARGETS,
  createBuildContext,
  simulateBuildAcrossSeeds,
  validateBuildCorpus,
} from '../assets/scripts/simulation/builds/index.ts';
import { DEFAULT_DUNGEON_DIFFICULTY_CONFIG } from '../assets/scripts/pve/dungeon/difficulty/DungeonDifficulty.ts';
import { loadTowerConfig, towerConfig } from '../assets/scripts/pve/tower/TowerConfig.ts';
import { validateBossConfig } from '../assets/scripts/core/boss/index.ts';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
const matrix = readJson('assets/resources/config/balance/difficulty-matrix.json');

const EXPECTED_ROOT_KEYS = [
  'schemaVersion', 'table', 'evidenceLevel', 'version', 'enabled', 'sources',
  'buildStrengthCalibration', 'modeProfiles',
];
const SCORE_METRICS = [
  'unitCards', 'skillCards', 'uniqueCardCount', 'totalAttack', 'totalMaxHp',
  'effectApplications', 'deployedUnits', 'castSkills',
];
const REQUIRED_MINIMUM_METRICS = [
  'minUnitCards', 'minUniqueCardCount', 'minDeployedUnits', 'minEffectApplications', 'minTotalMaxHp',
];
const MODES = ['mainline', 'dungeon', 'tower', 'boss'];
const BANDS = ['ENTRY', 'STANDARD', 'ADVANCED', 'ELITE'];
const clone = (value) => structuredClone(value);
const keysOf = (value) => Object.keys(value).sort();
const expectKeys = (value, expected, label) => assert.deepEqual(keysOf(value), [...expected].sort(), `${label} fields must be exact`);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const nonNegativeNumber = (value) => finiteNumber(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function validateMatrixShape(value) {
  assert(isRecord(value), 'difficulty matrix must be an object');
  expectKeys(value, EXPECTED_ROOT_KEYS, 'matrix');
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.table, 'difficulty-matrix');
  assert.equal(value.evidenceLevel, 'C');
  assert(positiveInteger(value.version));
  assert.equal(value.enabled, true);

  expectKeys(value.sources, Object.keys(value.sources), 'matrix.sources');
  for (const [key, source] of Object.entries(value.sources)) {
    assert.equal(typeof key, 'string');
    assert.equal(typeof source, 'string');
    assert(source.length > 0, `matrix.sources.${key} must not be empty`);
  }

  const calibration = value.buildStrengthCalibration;
  expectKeys(calibration, ['simulation', 'scoreFormula', 'bands', 'builds'], 'buildStrengthCalibration');
  expectKeys(calibration.simulation, ['seeds', 'rounds', 'openingHandSize', 'drawPerRound', 'preparePointsPerRound', 'handLimit'], 'simulation');
  assert.deepEqual(calibration.simulation.seeds, [11, 29, 47]);
  assert.equal(new Set(calibration.simulation.seeds).size, calibration.simulation.seeds.length);
  assert(calibration.simulation.seeds.every(Number.isSafeInteger));
  for (const key of ['rounds', 'openingHandSize', 'drawPerRound', 'preparePointsPerRound', 'handLimit']) {
    assert(positiveInteger(calibration.simulation[key]), `simulation.${key} must be positive`);
  }
  expectKeys(calibration.scoreFormula, ['rounding', 'weights'], 'scoreFormula');
  assert.equal(calibration.scoreFormula.rounding, 'nearestInteger');
  expectKeys(calibration.scoreFormula.weights, SCORE_METRICS, 'scoreFormula.weights');
  for (const metric of SCORE_METRICS) assert(finiteNumber(calibration.scoreFormula.weights[metric]) && calibration.scoreFormula.weights[metric] > 0);

  assert(Array.isArray(calibration.bands) && calibration.bands.length === BANDS.length);
  let nextMin = 0;
  for (const [index, band] of calibration.bands.entries()) {
    expectKeys(band, ['id', 'minScore', 'maxScore'], `bands[${index}]`);
    assert.equal(band.id, BANDS[index]);
    assert.equal(band.minScore, nextMin);
    assert(Number.isSafeInteger(band.minScore) && Number.isSafeInteger(band.maxScore));
    assert(band.minScore <= band.maxScore);
    nextMin = band.maxScore + 1;
  }
  assert.equal(nextMin, 1000);

  assert(Array.isArray(calibration.builds) && calibration.builds.length === 22, 'calibration must preserve all 22 T255 builds');
  const buildIds = new Set();
  for (const [index, build] of calibration.builds.entries()) {
    expectKeys(build, ['buildId', 'strengthScore', 'band'], `calibration.builds[${index}]`);
    assert(!buildIds.has(build.buildId), `duplicate calibration build ${build.buildId}`);
    buildIds.add(build.buildId);
    assert(typeof build.buildId === 'string' && build.buildId.length > 0);
    assert(Number.isSafeInteger(build.strengthScore) && build.strengthScore >= 0);
    assert(BANDS.includes(build.band));
    const band = calibration.bands.find(({ id }) => id === build.band);
    assert(build.strengthScore >= band.minScore && build.strengthScore <= band.maxScore, `${build.buildId} is outside its band`);
  }

  assert(Array.isArray(value.modeProfiles) && value.modeProfiles.length === MODES.length);
  const modeIds = new Set();
  for (const [index, profile] of value.modeProfiles.entries()) {
    expectKeys(profile, ['id', 'label', 'sourceType', 'minimumMetrics', 'entries'], `modeProfiles[${index}]`);
    assert.equal(profile.id, MODES[index]);
    assert(!modeIds.has(profile.id));
    modeIds.add(profile.id);
    assert(typeof profile.label === 'string' && profile.label.length > 0);
    assert(typeof profile.sourceType === 'string' && profile.sourceType.length > 0);
    expectKeys(profile.minimumMetrics, REQUIRED_MINIMUM_METRICS, `${profile.id}.minimumMetrics`);
    for (const metric of REQUIRED_MINIMUM_METRICS) assert(nonNegativeNumber(profile.minimumMetrics[metric]));
    assert(Array.isArray(profile.entries) && profile.entries.length > 0, `${profile.id} must have entries`);
    const entryIds = new Set();
    for (const [entryIndex, entry] of profile.entries.entries()) {
      assert(isRecord(entry), `${profile.id}.entries[${entryIndex}] must be an object`);
      assert(typeof entry.id === 'string' && entry.id.length > 0);
      assert(!entryIds.has(entry.id), `${profile.id} contains duplicate entry ${entry.id}`);
      entryIds.add(entry.id);
      assert(Number.isSafeInteger(entry.requiredBuildScore) && entry.requiredBuildScore >= 0);
      assert(BANDS.includes(entry.requiredBand));
      assert(entry.requiredBuildScore >= calibration.bands.find(({ id }) => id === entry.requiredBand).minScore);
      for (const optionalMetric of REQUIRED_MINIMUM_METRICS.slice(2)) {
        if (Object.hasOwn(entry, optionalMetric)) assert(nonNegativeNumber(entry[optionalMetric]));
      }
    }
  }
}

function validateThresholdSemantics(value) {
  const profiles = new Map(value.modeProfiles.map((profile) => [profile.id, profile]));
  const mainline = profiles.get('mainline');
  const dungeon = profiles.get('dungeon');
  const tower = profiles.get('tower');
  const boss = profiles.get('boss');
  assert(mainline && dungeon && tower && boss, 'all four mode profiles are required');
  const strictlyIncreasing = (entries, label) => {
    for (let index = 1; index < entries.length; index += 1) {
      assert(entries[index].requiredBuildScore > entries[index - 1].requiredBuildScore, `${label} thresholds must increase`);
    }
  };
  strictlyIncreasing(mainline.entries, 'mainline');
  strictlyIncreasing(tower.entries, 'tower');
  assert(dungeon.entries[1].requiredBuildScore > dungeon.entries[0].requiredBuildScore, 'hard dungeon threshold must increase');
  assert(boss.entries[0].requiredBuildScore > dungeon.entries[1].requiredBuildScore, 'boss threshold must exceed hard dungeon');
  assert(boss.minimumMetrics.minEffectApplications > dungeon.minimumMetrics.minEffectApplications, 'boss effect requirement must exceed dungeon');
  assert(boss.minimumMetrics.minTotalMaxHp > dungeon.minimumMetrics.minTotalMaxHp, 'boss hp requirement must exceed dungeon');
}

function buildScore(summary, simulation) {
  const average = (key) => simulation.runs.reduce((sum, run) => sum + run[key], 0) / simulation.runs.length;
  const metrics = {
    unitCards: summary.unitCards,
    skillCards: summary.skillCards,
    uniqueCardCount: summary.uniqueCardCount,
    totalAttack: average('totalAttack'),
    totalMaxHp: average('totalMaxHp'),
    effectApplications: average('effectApplications'),
    deployedUnits: average('deployedUnits'),
    castSkills: average('castSkills'),
  };
  const weighted = SCORE_METRICS.reduce((total, metric) => total + metrics[metric] * matrix.buildStrengthCalibration.scoreFormula.weights[metric], 0);
  return { score: Math.round(weighted), metrics };
}

function bandForScore(score) {
  return matrix.buildStrengthCalibration.bands.find(({ minScore, maxScore }) => score >= minScore && score <= maxScore)?.id;
}

function isEligible(build, profile, entry) {
  const minimum = { ...profile.minimumMetrics, ...Object.fromEntries(REQUIRED_MINIMUM_METRICS.map((metric) => [metric, entry[metric] ?? profile.minimumMetrics[metric]])) };
  return build.score >= entry.requiredBuildScore
    && build.metrics.unitCards >= minimum.minUnitCards
    && build.metrics.uniqueCardCount >= minimum.minUniqueCardCount
    && build.metrics.deployedUnits >= minimum.minDeployedUnits
    && build.metrics.effectApplications >= minimum.minEffectApplications
    && build.metrics.totalMaxHp >= minimum.minTotalMaxHp;
}

validateMatrixShape(matrix);
validateThresholdSemantics(matrix);
const calibration = matrix.buildStrengthCalibration;
const readRows = (relativePath, key) => {
  const document = readJson(relativePath);
  assert(Array.isArray(document[key]) && document[key].length > 0, `${relativePath}.${key} must be a real table`);
  return document[key];
};
const context = createBuildContext({
  cards: readRows('assets/resources/config/cards.json', 'cards'),
  units: readRows('assets/resources/config/units.json', 'units'),
  skills: readRows('assets/resources/config/skills.json', 'skills'),
  professions: readRows('assets/resources/config/professions.json', 'professions'),
  decks: readRows('assets/resources/config/decks.json', 'decks'),
});
const corpus = validateBuildCorpus({
  documents: BUILD_TARGETS.map((target) => ({ target, document: readJson(`assets/resources/config/builds/${target}.json`) })),
  context,
});
const simulations = new Map();
const scoredBuilds = new Map();
for (const summary of corpus.summaries) {
  const simulation = simulateBuildAcrossSeeds(summary.build, context, calibration.simulation.seeds, calibration.simulation);
  assert.equal(simulation.deterministic, true, `${summary.build.id} simulation must be deterministic`);
  const repeat = simulateBuildAcrossSeeds(summary.build, context, calibration.simulation.seeds, calibration.simulation);
  assert.deepEqual(repeat, simulation, `${summary.build.id} simulation must be replay-stable`);
  const scored = buildScore(summary, simulation);
  simulations.set(summary.build.id, simulation);
  scoredBuilds.set(summary.build.id, { ...scored, summary });
}

assert.equal(calibration.builds.length, scoredBuilds.size, 'calibration must cover every real T255 build');
for (const calibrationBuild of calibration.builds) {
  const scored = scoredBuilds.get(calibrationBuild.buildId);
  assert(scored, `${calibrationBuild.buildId} must reference a real T255 build`);
  assert.equal(scored.score, calibrationBuild.strengthScore, `${calibrationBuild.buildId} score drifted from real simulation`);
  assert.equal(bandForScore(scored.score), calibrationBuild.band, `${calibrationBuild.buildId} band drifted`);
}

const mainlineIndex = readRows('assets/resources/config/levels/chapter01/index.json', 'levels');
const strategies = readRows('assets/resources/config/enemy/strategies.json', 'strategies');
const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
const levelById = new Map(mainlineIndex.map((level) => [level.id, level]));
const mainline = matrix.modeProfiles.find(({ id }) => id === 'mainline');
assert.deepEqual(mainline.entries.map(({ id }) => id), mainlineIndex.map(({ id }) => id), 'mainline matrix must cover the chapter index exactly');
assert(mainline.entries.every((entry, index) => {
  const strategy = strategyById.get(entry.strategyId);
  return levelById.has(entry.id) && strategy?.levelId === entry.id && (index === 0 || entry.requiredBuildScore > mainline.entries[index - 1].requiredBuildScore);
}), 'mainline requirements must follow real level strategies and increase');

const dungeon = matrix.modeProfiles.find(({ id }) => id === 'dungeon');
assert.deepEqual(dungeon.entries.map(({ id }) => id), DEFAULT_DUNGEON_DIFFICULTY_CONFIG.map(({ id }) => id));
assert(dungeon.entries[1].requiredBuildScore > dungeon.entries[0].requiredBuildScore, 'hard dungeon must require more strength than normal');
for (const entry of dungeon.entries) {
  const definition = DEFAULT_DUNGEON_DIFFICULTY_CONFIG.find(({ id }) => id === entry.id);
  assert.equal(entry.stageCount, definition.stages.length, `${entry.id} stage count must match the real dungeon config`);
}

const tower = matrix.modeProfiles.find(({ id }) => id === 'tower');
const loadedTower = loadTowerConfig(towerConfig, new Set(readRows('assets/resources/config/units.json', 'units').map(({ id }) => id)));
assert.deepEqual(tower.entries.map(({ id }) => id), loadedTower.stages.map(({ id }) => id));
assert(tower.entries.every((entry, index) => {
  const stage = loadedTower.stages[index];
  return entry.floorStart === stage.floorStart
    && entry.floorEnd === stage.floorEnd
    && (index === 0 || entry.requiredBuildScore > tower.entries[index - 1].requiredBuildScore);
}), 'tower stage requirements must follow real stage boundaries and increase');

const bossDocument = readJson('assets/resources/config/levels/chapter01/boss-rewards.json');
const bossDefinitions = bossDocument.bosses.map(({ config }) => validateBossConfig(config));
const boss = matrix.modeProfiles.find(({ id }) => id === 'boss');
assert.deepEqual(boss.entries.map(({ id }) => id), bossDefinitions.map(({ id }) => id));
for (const entry of boss.entries) {
  const definition = bossDefinitions.find(({ id }) => id === entry.id);
  assert.equal(entry.maxHp, definition.maxHp);
  assert.equal(entry.phaseCount, definition.phases.length);
}
assert(boss.entries[0].requiredBuildScore > dungeon.entries[1].requiredBuildScore, 'boss must require more strength than hard dungeon');
assert(boss.minimumMetrics.minEffectApplications > dungeon.minimumMetrics.minEffectApplications);
assert(boss.minimumMetrics.minTotalMaxHp > dungeon.minimumMetrics.minTotalMaxHp);

const eligibilityCounts = {};
for (const profile of matrix.modeProfiles) {
  eligibilityCounts[profile.id] = {};
  for (const entry of profile.entries) {
    const eligible = [...scoredBuilds.values()].filter((build) => isEligible(build, profile, entry));
    assert(eligible.length > 0, `${profile.id}/${entry.id} must retain at least one eligible real build`);
    eligibilityCounts[profile.id][entry.id] = eligible.length;
  }
}

let negativeCases = 0;
function expectRejected(label, mutate) {
  const candidate = clone(matrix);
  mutate(candidate);
  assert.throws(() => {
    validateMatrixShape(candidate);
    validateThresholdSemantics(candidate);
  }, `${label} must be rejected`);
  negativeCases += 1;
}

expectRejected('unknown root field', (candidate) => { candidate.extra = true; });
expectRejected('duplicate calibration build', (candidate) => { candidate.buildStrengthCalibration.builds[1].buildId = candidate.buildStrengthCalibration.builds[0].buildId; });
expectRejected('score outside band', (candidate) => { candidate.buildStrengthCalibration.builds[0].strengthScore = 419; });
expectRejected('non-contiguous bands', (candidate) => { candidate.buildStrengthCalibration.bands[1].minScore = 421; });
expectRejected('missing build entry', (candidate) => { candidate.buildStrengthCalibration.builds.pop(); });
expectRejected('unknown mode', (candidate) => { candidate.modeProfiles[0].id = 'arena'; });
expectRejected('empty mode entries', (candidate) => { candidate.modeProfiles[2].entries = []; });
expectRejected('mainline threshold regression', (candidate) => { candidate.modeProfiles[0].entries[5].requiredBuildScore = 419; });
expectRejected('hard dungeon threshold regression', (candidate) => { candidate.modeProfiles[1].entries[1].requiredBuildScore = 429; });
expectRejected('tower threshold regression', (candidate) => { candidate.modeProfiles[2].entries[5].requiredBuildScore = 470; });

const standardEntry = mainline.entries[5];
const exactBoundary = { score: standardEntry.requiredBuildScore, metrics: { ...mainline.minimumMetrics, unitCards: 24, uniqueCardCount: 10, deployedUnits: 8, effectApplications: 0, totalMaxHp: 35 } };
const belowBoundary = { ...exactBoundary, score: exactBoundary.score - 1 };
assert.equal(isEligible(exactBoundary, mainline, standardEntry), true, 'exact score boundary must be eligible');
assert.equal(isEligible(belowBoundary, mainline, standardEntry), false, 'score below boundary must be rejected');
const metricBoundary = { ...exactBoundary, metrics: { ...exactBoundary.metrics, minUniqueCardCount: undefined, uniqueCardCount: 9 } };
assert.equal(isEligible(metricBoundary, mainline, standardEntry), false, 'metric below boundary must be rejected');
assert.equal(isEligible({ ...exactBoundary, metrics: { ...exactBoundary.metrics, totalMaxHp: 34 } }, mainline, standardEntry), false, 'hp below boundary must be rejected');
negativeCases += 3;

assert.equal(negativeCases, 13, 'all negative and regression cases must execute');
console.log(`T256 difficulty matrix PASS: modes=${MODES.length}, mainline=${mainline.entries.length}, dungeon=${dungeon.entries.length}, towerStages=${tower.entries.length}, bosses=${boss.entries.length}, builds=${scoredBuilds.size}, eligibility=${JSON.stringify(eligibilityCounts)}, negative-cases=${negativeCases}, deterministic-seeds=${calibration.simulation.seeds.length}`);
