import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_TARGETS,
  createBuildContext,
  simulateBuildAcrossSeeds,
  validateBuildCorpus,
} from '../assets/scripts/simulation/builds/index.ts';
import { DEFAULT_DUNGEON_DIFFICULTY_CONFIG } from '../assets/scripts/pve/dungeon/difficulty/DungeonDifficulty.ts';
import { loadTowerConfig, towerConfig } from '../assets/scripts/pve/tower/TowerConfig.ts';
import { validateBossConfig } from '../assets/scripts/core/boss/index.ts';
import {
  DIFFICULTY_MATRIX,
  getDifficultyEntry,
  getDifficultyProfile,
  loadDifficultyMatrix,
  parseJsonWithUniqueKeys,
} from '../assets/resources/config/balance/difficulty-matrix.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relativePath) => parseJsonWithUniqueKeys(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'), relativePath);
const matrix = DIFFICULTY_MATRIX;

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
const BANDS = ['ENTRY', 'CORE', 'ADVANCED', 'EXPERT'];
const SOURCE_KEYS = ['builds', 'mainlineLevels', 'mainlineStrategies', 'dungeonDifficulty', 'tower', 'bosses'];
const SOURCE_TYPES = ['chapterLevels', 'dungeonDifficulties', 'towerStages', 'bossConfigs'];
const MODE_SOURCE_TYPES = {
  mainline: 'chapterLevels',
  dungeon: 'dungeonDifficulties',
  tower: 'towerStages',
  boss: 'bossConfigs',
};
const MODE_ENTRY_IDS = {
  mainline: new Set(Array.from({ length: 12 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`)),
  dungeon: new Set(['NORMAL', 'HARD']),
  tower: new Set(Array.from({ length: 10 }, (_, index) => `STAGE_${String(index + 1).padStart(2, '0')}`)),
  boss: new Set(['BOSS-T225-IRON-ROOT']),
};
const ENTRY_REQUIRED_KEYS = {
  mainline: ['id', 'strategyId', 'requiredBuildScore', 'requiredBand'],
  dungeon: ['id', 'stageCount', 'requiredBuildScore', 'requiredBand'],
  tower: ['id', 'floorStart', 'floorEnd', 'requiredBuildScore', 'requiredBand'],
  boss: ['id', 'maxHp', 'phaseCount', 'requiredBuildScore', 'requiredBand'],
};
const ENTRY_OPTIONAL_KEYS = {
  mainline: [],
  dungeon: ['minEffectApplications', 'minDeployedUnits', 'minTotalMaxHp'],
  tower: [],
  boss: [],
};
const GOLDEN_SCORE_BANDS = [
  ['ENTRY', 0, 419],
  ['CORE', 420, 459],
  ['ADVANCED', 460, 499],
  ['EXPERT', 500, 999],
];
const GOLDEN_BUILD_SCORES = {
  'P01-B01': 453, 'P01-B02': 434, 'P02-B01': 531, 'P02-B02': 432,
  'P03-B01': 495, 'P03-B02': 498, 'P04-B01': 414, 'P04-B02': 485,
  'R01-B01': 440, 'R01-B02': 532, 'R02-B01': 491, 'R02-B02': 498,
  'R03-B01': 440, 'R03-B02': 457, 'R04-B01': 490, 'R04-B02': 485,
  'R05-B01': 520, 'R05-B02': 499, 'R06-B01': 498, 'R06-B02': 480,
  'R07-B01': 500, 'R07-B02': 449,
};
const GOLDEN_ENTRY_REQUIREMENTS = {
  mainline: {
    L01: [360, 'ENTRY'], L02: [370, 'ENTRY'], L03: [380, 'ENTRY'], L04: [395, 'ENTRY'],
    L05: [405, 'ENTRY'], L06: [420, 'CORE'], L07: [430, 'CORE'], L08: [440, 'CORE'],
    L09: [455, 'CORE'], L10: [465, 'ADVANCED'], L11: [480, 'ADVANCED'], L12: [500, 'EXPERT'],
  },
  dungeon: { NORMAL: [430, 'CORE'], HARD: [500, 'EXPERT'] },
  tower: {
    STAGE_01: [430, 'CORE'], STAGE_02: [440, 'CORE'], STAGE_03: [455, 'CORE'], STAGE_04: [465, 'ADVANCED'],
    STAGE_05: [475, 'ADVANCED'], STAGE_06: [485, 'ADVANCED'], STAGE_07: [495, 'ADVANCED'],
    STAGE_08: [505, 'EXPERT'], STAGE_09: [515, 'EXPERT'], STAGE_10: [525, 'EXPERT'],
  },
  boss: { 'BOSS-T225-IRON-ROOT': [520, 'EXPERT'] },
};
const GOLDEN_SEED_SUMMARY = {
  'P01-B01': [
    { seed: 11, totalAttack: 21, totalMaxHp: 46, effectApplications: 1, deployedUnits: 9, castSkills: 1 },
    { seed: 29, totalAttack: 19, totalMaxHp: 46, effectApplications: 0, deployedUnits: 9, castSkills: 0 },
    { seed: 47, totalAttack: 23, totalMaxHp: 58, effectApplications: 1, deployedUnits: 11, castSkills: 1 },
  ],
};
const clone = (value) => structuredClone(value);
const keysOf = (value) => Object.keys(value).sort();
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const nonNegativeNumber = (value) => finiteNumber(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function assertPlainRecord(value, label) {
  assert(isRecord(value), `${label} must be an object`);
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${label} must not have a custom prototype`);
  for (const key in value) assert(Object.hasOwn(value, key), `${label} has inherited field ${key}`);
  for (const key of Object.keys(value)) assert(!DANGEROUS_KEYS.has(key), `${label} contains dangerous field ${key}`);
  return value;
}

function assertSafeArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert.equal(Object.getPrototypeOf(value), Array.prototype, `${label} must not have a custom prototype`);
  for (const key of Object.keys(value)) assert(/^\d+$/.test(key), `${label} contains non-index field ${key}`);
  return value;
}

const expectKeys = (value, expected, label) => assert.deepEqual(
  keysOf(assertPlainRecord(value, label)),
  [...expected].sort(),
  `${label} fields must be exact`,
);
const bandRank = (band) => {
  const rank = BANDS.indexOf(band);
  assert(rank >= 0, `unknown difficulty band ${band}`);
  return rank;
};

function validateMatrixShape(value) {
  assertPlainRecord(value, 'matrix');
  expectKeys(value, EXPECTED_ROOT_KEYS, 'matrix');
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.table, 'difficulty-matrix');
  assert.equal(value.evidenceLevel, 'C');
  assert(positiveInteger(value.version));
  assert.equal(value.enabled, true);

  expectKeys(value.sources, SOURCE_KEYS, 'matrix.sources');
  for (const [key, source] of Object.entries(value.sources)) {
    assert(SOURCE_KEYS.includes(key), `matrix.sources.${key} is not approved`);
    assert.equal(typeof source, 'string', `matrix.sources.${key} must be a string`);
    assert(source.length > 0, `matrix.sources.${key} must not be empty`);
  }

  const calibration = value.buildStrengthCalibration;
  expectKeys(calibration, ['simulation', 'scoreFormula', 'bands', 'builds'], 'buildStrengthCalibration');
  expectKeys(calibration.simulation, ['seeds', 'rounds', 'openingHandSize', 'drawPerRound', 'preparePointsPerRound', 'handLimit'], 'simulation');
  assertSafeArray(calibration.simulation.seeds, 'simulation.seeds');
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

  assertSafeArray(calibration.bands, 'bands');
  assert.equal(calibration.bands.length, BANDS.length);
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
  assert.deepEqual(calibration.bands.map(({ id, minScore, maxScore }) => [id, minScore, maxScore]), GOLDEN_SCORE_BANDS, 'score bands must match approved calibration');

  assertSafeArray(calibration.builds, 'calibration.builds');
  assert.equal(calibration.builds.length, 22, 'calibration must preserve all 22 T255 builds');
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

  assertSafeArray(value.modeProfiles, 'modeProfiles');
  assert.equal(value.modeProfiles.length, MODES.length);
  const modeIds = new Set();
  for (const [index, profile] of value.modeProfiles.entries()) {
    expectKeys(profile, ['id', 'label', 'sourceType', 'minimumMetrics', 'entries'], `modeProfiles[${index}]`);
    assert.equal(profile.id, MODES[index]);
    assert(!modeIds.has(profile.id));
    modeIds.add(profile.id);
    assert(typeof profile.label === 'string' && profile.label.length > 0);
    assert(SOURCE_TYPES.includes(profile.sourceType), `${profile.id} has an unapproved sourceType`);
    assert.equal(profile.sourceType, MODE_SOURCE_TYPES[profile.id], `${profile.id} sourceType must match its mode`);
    expectKeys(profile.minimumMetrics, REQUIRED_MINIMUM_METRICS, `${profile.id}.minimumMetrics`);
    for (const metric of REQUIRED_MINIMUM_METRICS) assert(nonNegativeNumber(profile.minimumMetrics[metric]));
    assertSafeArray(profile.entries, `${profile.id}.entries`);
    assert(profile.entries.length > 0, `${profile.id} must have entries`);
    const entryIds = new Set();
    for (const [entryIndex, entry] of profile.entries.entries()) {
      const entryLabel = `${profile.id}.entries[${entryIndex}]`;
      assertPlainRecord(entry, entryLabel);
      const requiredKeys = ENTRY_REQUIRED_KEYS[profile.id];
      const allowedKeys = [...requiredKeys, ...ENTRY_OPTIONAL_KEYS[profile.id]];
      for (const key of requiredKeys) assert(Object.hasOwn(entry, key), `${entryLabel}.${key} is required`);
      for (const key of Object.keys(entry)) assert(allowedKeys.includes(key), `${entryLabel}.${key} is not approved`);
      assert(typeof entry.id === 'string' && MODE_ENTRY_IDS[profile.id].has(entry.id), `${entryLabel}.id is not an approved ${profile.id} entry`);
      assert(!entryIds.has(entry.id), `${profile.id} contains duplicate entry ${entry.id}`);
      entryIds.add(entry.id);
      assert(Number.isSafeInteger(entry.requiredBuildScore) && entry.requiredBuildScore >= 0);
      assert(BANDS.includes(entry.requiredBand), `${entryLabel}.requiredBand is not approved`);
      assert(entry.requiredBuildScore >= calibration.bands.find(({ id }) => id === entry.requiredBand).minScore);
      if (profile.id === 'mainline') assert(/^ES_L\d{2}$/.test(entry.strategyId), `${entryLabel}.strategyId is invalid`);
      if (profile.id === 'dungeon') assert(positiveInteger(entry.stageCount), `${entryLabel}.stageCount must be positive`);
      if (profile.id === 'tower') {
        assert(positiveInteger(entry.floorStart) && positiveInteger(entry.floorEnd), `${entryLabel}.floor range must be positive`);
        assert(entry.floorEnd >= entry.floorStart, `${entryLabel}.floor range must be ordered`);
      }
      if (profile.id === 'boss') {
        assert(positiveInteger(entry.maxHp), `${entryLabel}.maxHp must be positive`);
        assert(positiveInteger(entry.phaseCount), `${entryLabel}.phaseCount must be positive`);
      }
      for (const optionalMetric of ENTRY_OPTIONAL_KEYS[profile.id]) {
        if (Object.hasOwn(entry, optionalMetric)) assert(nonNegativeNumber(entry[optionalMetric]), `${entryLabel}.${optionalMetric} must be finite and non-negative`);
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
  return bandRank(build.band) >= bandRank(entry.requiredBand)
    && build.score >= entry.requiredBuildScore
    && build.metrics.unitCards >= minimum.minUnitCards
    && build.metrics.uniqueCardCount >= minimum.minUniqueCardCount
    && build.metrics.deployedUnits >= minimum.minDeployedUnits
    && build.metrics.effectApplications >= minimum.minEffectApplications
    && build.metrics.totalMaxHp >= minimum.minTotalMaxHp;
}

validateMatrixShape(matrix);
validateThresholdSemantics(matrix);
assert(Object.isFrozen(matrix), 'difficulty matrix export must be immutable');
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
  if (GOLDEN_SEED_SUMMARY[summary.build.id]) {
    const seedSummary = simulation.runs.map(({ seed, totalAttack, totalMaxHp, effectApplications, deployedUnits, castSkills }) => ({
      seed, totalAttack, totalMaxHp, effectApplications, deployedUnits, castSkills,
    }));
    assert.deepEqual(seedSummary, GOLDEN_SEED_SUMMARY[summary.build.id], `${summary.build.id} seed summary must remain independent and reproducible`);
    assert(new Set(seedSummary.map(({ totalAttack, totalMaxHp, effectApplications, deployedUnits, castSkills }) => `${totalAttack}/${totalMaxHp}/${effectApplications}/${deployedUnits}/${castSkills}`)).size > 1, `${summary.build.id} must respond to different seeds`);
    const sameSeed = simulateBuildAcrossSeeds(summary.build, context, [calibration.simulation.seeds[0]], calibration.simulation);
    assert.deepEqual(sameSeed.runs[0], simulation.runs[0], `${summary.build.id} must be deterministic for a fixed seed`);
  }
  const scored = buildScore(summary, simulation);
  simulations.set(summary.build.id, simulation);
  scoredBuilds.set(summary.build.id, { ...scored, band: bandForScore(scored.score), summary });
}

assert.equal(calibration.builds.length, scoredBuilds.size, 'calibration must cover every real T255 build');
assert.deepEqual([...scoredBuilds.keys()].sort(), Object.keys(GOLDEN_BUILD_SCORES).sort(), 'T255 golden corpus coverage must be exact');
for (const calibrationBuild of calibration.builds) {
  const scored = scoredBuilds.get(calibrationBuild.buildId);
  assert(scored, `${calibrationBuild.buildId} must reference a real T255 build`);
  assert.equal(scored.score, GOLDEN_BUILD_SCORES[calibrationBuild.buildId], `${calibrationBuild.buildId} score drifted from the independent T255 golden result`);
  assert.equal(scored.score, calibrationBuild.strengthScore, `${calibrationBuild.buildId} score drifted from real simulation`);
  assert.equal(scored.band, calibrationBuild.band, `${calibrationBuild.buildId} band drifted`);
  assert.equal(bandForScore(scored.score), calibrationBuild.band, `${calibrationBuild.buildId} band drifted`);
}

const mainlineIndex = readRows('assets/resources/config/levels/chapter01/index.json', 'levels');
const strategies = readRows('assets/resources/config/enemy/strategies.json', 'strategies');
const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
const levelById = new Map(mainlineIndex.map((level) => [level.id, level]));
const mainline = matrix.modeProfiles.find(({ id }) => id === 'mainline');
assert.strictEqual(getDifficultyProfile('mainline'), mainline, 'consumer profile export must expose the real mainline profile');
assert.strictEqual(getDifficultyEntry('mainline', 'L06'), mainline.entries[5], 'consumer entry export must expose the real L06 entry');
assert.equal(getDifficultyProfile('arena'), undefined, 'consumer profile export must fail closed for unknown mode');
assert.equal(getDifficultyEntry('mainline', 'L99'), undefined, 'consumer entry export must fail closed for unknown level');
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

for (const profile of matrix.modeProfiles) {
  for (const entry of profile.entries) {
    assert.deepEqual(
      [entry.requiredBuildScore, entry.requiredBand],
      GOLDEN_ENTRY_REQUIREMENTS[profile.id][entry.id],
      `${profile.id}/${entry.id} must match the independent approved difficulty point`,
    );
  }
}

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
expectRejected('unknown source field', (candidate) => { candidate.sources.forged = 'config/forged'; });
expectRejected('duplicate calibration build', (candidate) => { candidate.buildStrengthCalibration.builds[1].buildId = candidate.buildStrengthCalibration.builds[0].buildId; });
expectRejected('score outside band', (candidate) => { candidate.buildStrengthCalibration.builds[0].strengthScore = 419; });
expectRejected('non-contiguous bands', (candidate) => { candidate.buildStrengthCalibration.bands[1].minScore = 421; });
expectRejected('missing build entry', (candidate) => { candidate.buildStrengthCalibration.builds.pop(); });
expectRejected('unknown mode', (candidate) => { candidate.modeProfiles[0].id = 'arena'; });
expectRejected('unknown sourceType', (candidate) => { candidate.modeProfiles[0].sourceType = 'forgedSource'; });
expectRejected('empty mode entries', (candidate) => { candidate.modeProfiles[2].entries = []; });
expectRejected('unknown entry field', (candidate) => { candidate.modeProfiles[0].entries[0].forged = true; });
expectRejected('unknown level', (candidate) => { candidate.modeProfiles[0].entries[0].id = 'L99'; });
expectRejected('duplicate entry key', (candidate) => { candidate.modeProfiles[0].entries[1].id = candidate.modeProfiles[0].entries[0].id; });
expectRejected('invalid required band', (candidate) => { candidate.modeProfiles[0].entries[5].requiredBand = 'STANDARD'; });
expectRejected('NaN threshold', (candidate) => { candidate.modeProfiles[0].entries[5].requiredBuildScore = Number.NaN; });
expectRejected('Infinity threshold', (candidate) => { candidate.modeProfiles[0].entries[5].requiredBuildScore = Number.POSITIVE_INFINITY; });
expectRejected('prototype pollution', (candidate) => { candidate.modeProfiles[0].entries[0].__proto__ = { polluted: true }; });
expectRejected('mainline threshold regression', (candidate) => { candidate.modeProfiles[0].entries[5].requiredBuildScore = 419; });
expectRejected('hard dungeon threshold regression', (candidate) => { candidate.modeProfiles[1].entries[1].requiredBuildScore = 429; });
expectRejected('tower threshold regression', (candidate) => { candidate.modeProfiles[2].entries[5].requiredBuildScore = 470; });

const temporaryMatrixDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 't256-difficulty-matrix-'));
const temporaryMatrixPath = path.join(temporaryMatrixDirectory, 'difficulty-matrix.json');
const matrixSource = fs.readFileSync(path.join(projectRoot, 'assets/resources/config/balance/difficulty-matrix.json'), 'utf8');
try {
  fs.copyFileSync(path.join(projectRoot, 'assets/resources/config/balance/difficulty-matrix.json'), temporaryMatrixPath);
  assert.deepEqual(loadDifficultyMatrix(temporaryMatrixPath), matrix, 'a valid temporary matrix copy must load unchanged');
  const duplicateJsonCases = [
    ['duplicate table key', matrixSource.replace('  "table": "difficulty-matrix",', '  "table": "difficulty-matrix",\n  "table": "difficulty-matrix",')],
    ['duplicate entry key', matrixSource.replace('"id": "L01", "strategyId"', '"id": "L01", "id": "L01", "strategyId"')],
    ['duplicate nested field', matrixSource.replace('        "totalAttack": 8,', '        "totalAttack": 8,\n        "totalAttack": 8,')],
  ];
  for (const [label, duplicateSource] of duplicateJsonCases) {
    fs.writeFileSync(temporaryMatrixPath, duplicateSource);
    assert.throws(
      () => loadDifficultyMatrix(temporaryMatrixPath),
      /Duplicate JSON object key/,
      `${label} must be rejected before JSON key overwrite`,
    );
  }
  negativeCases += duplicateJsonCases.length;
} finally {
  fs.rmSync(temporaryMatrixDirectory, { force: true, recursive: true });
}

const standardEntry = mainline.entries[5];
const exactBoundary = { score: standardEntry.requiredBuildScore, band: 'CORE', metrics: { ...mainline.minimumMetrics, unitCards: 24, uniqueCardCount: 10, deployedUnits: 8, effectApplications: 0, totalMaxHp: 35 } };
const belowBoundary = { ...exactBoundary, score: exactBoundary.score - 1 };
assert.equal(isEligible(exactBoundary, mainline, standardEntry), true, 'exact score boundary must be eligible');
assert.equal(isEligible(belowBoundary, mainline, standardEntry), false, 'score below boundary must be rejected');
const metricBoundary = { ...exactBoundary, metrics: { ...exactBoundary.metrics, minUniqueCardCount: undefined, uniqueCardCount: 9 } };
assert.equal(isEligible(metricBoundary, mainline, standardEntry), false, 'metric below boundary must be rejected');
assert.equal(isEligible({ ...exactBoundary, metrics: { ...exactBoundary.metrics, totalMaxHp: 34 } }, mainline, standardEntry), false, 'hp below boundary must be rejected');
assert.equal(isEligible(exactBoundary, mainline, { ...standardEntry, requiredBand: 'ADVANCED' }), false, 'requiredBand must gate eligibility independently of score');
assert.equal(isEligible({ ...exactBoundary, band: 'ENTRY' }, mainline, standardEntry), false, 'build band below requiredBand must be rejected');
negativeCases += 5;

assert.equal(negativeCases, 27, 'all negative and regression cases must execute');
console.log(`T256 difficulty matrix PASS: modes=${MODES.length}, mainline=${mainline.entries.length}, dungeon=${dungeon.entries.length}, towerStages=${tower.entries.length}, bosses=${boss.entries.length}, builds=${scoredBuilds.size}, eligibility=${JSON.stringify(eligibilityCounts)}, negative-cases=${negativeCases}, deterministic-seeds=${calibration.simulation.seeds.length}`);
