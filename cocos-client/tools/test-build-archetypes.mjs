import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILD_TARGETS,
  createBuildContext,
  simulateBuildAcrossSeeds,
  validateBuild,
  validateBuildCorpus,
} from '../assets/scripts/simulation/builds/index.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function readJson(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function rows(config, key) {
  assert(Array.isArray(config[key]) && config[key].length > 0, `${key} must be a non-empty real table`);
  return config[key];
}

const context = createBuildContext({
  cards: rows(readJson('assets/resources/config/cards.json'), 'cards'),
  units: rows(readJson('assets/resources/config/units.json'), 'units'),
  skills: rows(readJson('assets/resources/config/skills.json'), 'skills'),
  professions: rows(readJson('assets/resources/config/professions.json'), 'professions'),
  decks: rows(readJson('assets/resources/config/decks.json'), 'decks'),
});

const documents = BUILD_TARGETS.map((target) => ({
  target,
  document: readJson(`assets/resources/config/builds/${target}.json`),
}));

const corpus = validateBuildCorpus({ documents, context });
assert(corpus.builds.length >= BUILD_TARGETS.length * 2, 'the real build corpus must contain at least two builds per target');
assert.equal(corpus.professionIds.length, 4, 'real profession coverage must contain four professions');
assert.equal(corpus.races.length, 7, 'real race coverage must contain seven races');
for (const professionId of corpus.professionIds) {
  assert((corpus.coverage.professionCounts.get(professionId) ?? 0) >= 2, `${professionId} must have two valid builds`);
}
for (const race of corpus.races) {
  assert((corpus.coverage.raceCounts.get(race) ?? 0) >= 2, `${race} must have two valid builds`);
}
for (const target of BUILD_TARGETS) {
  assert((corpus.coverage.targetCounts.get(target) ?? 0) >= 2, `${target} must have two valid builds`);
}

const simulations = corpus.summaries.map((summary) => {
  const result = simulateBuildAcrossSeeds(summary.build, context, [11, 29, 47], {
    rounds: 8,
    openingHandSize: 5,
    drawPerRound: 1,
    preparePointsPerRound: 4,
    handLimit: 7,
  });
  assert.equal(result.deterministic, true, `${summary.build.id} simulation must be deterministic`);
  assert.equal(result.runs.length, 3, `${summary.build.id} must run all simulation seeds`);
  for (const run of result.runs) {
    assert.equal(run.deckSize, summary.build.totalCards, `${summary.build.id} simulation must use the real deck size`);
    assert(run.drawnCards > 0 && run.drawnCards <= summary.build.totalCards, `${summary.build.id} draw count is outside the real deck`);
    assert(run.deployedUnits <= summary.unitCards, `${summary.build.id} deployed more units than configured`);
    assert(run.castSkills <= summary.skillCards, `${summary.build.id} cast more skills than configured`);
    assert(run.events.some((event) => event.type === 'DRAW'), `${summary.build.id} simulation must produce draw events`);
    assert(run.events.some((event) => event.type === 'DEPLOY_UNIT'), `${summary.build.id} simulation must deploy a real unit`);
  }
  return result;
});

let negativeCases = 0;
function expectRejected(label, mutate, pattern) {
  const candidate = structuredClone(corpus.builds[0]);
  mutate(candidate);
  assert.throws(() => validateBuild(candidate, context), pattern, `${label} must be rejected`);
  negativeCases += 1;
}

expectRejected('missing profession', (build) => { delete build.professionId; }, /profession|fields invalid/);
expectRejected('illegal profession', (build) => { build.professionId = 'P999'; }, /profession/);
expectRejected('illegal race', (build) => { build.race = '不存在种族'; }, /race/);
expectRejected('unknown card', (build) => { build.entries[0].cardId = 'C999'; }, /card/);
expectRejected('missing card id', (build) => { delete build.entries[0].cardId; }, /cardId|fields invalid/);
expectRejected('duplicate slot', (build) => { build.entries[1].slot = build.entries[0].slot; }, /contiguous|duplicate/);
expectRejected('out-of-range slot', (build) => { build.entries[0].slot = 99; }, /contiguous/);
expectRejected('illegal skill for profession', (build) => {
  const skillEntry = build.entries.find((entry) => entry.cardId.startsWith('S'));
  assert(skillEntry, 'negative fixture requires a real skill entry');
  skillEntry.cardId = 'S001';
}, /not allowed/);
expectRejected('slot build count mutation', (build) => { build.entries[0].count = 2; }, /count/);
expectRejected('invalid count', (build) => { build.entries[0].count = 0; }, /positive integer|count/);
expectRejected('lowered unit threshold', (build) => { build.minUnitCards = 1; }, /minUnitCards|D001 contract/);
expectRejected('raised skill threshold', (build) => { build.maxSkillCards = build.totalCards; }, /maxSkillCards|D001 contract/);
const countedBuild = structuredClone(corpus.builds.find((build) => build.sourceFormat === 'cardEntries'));
assert(countedBuild, 'real corpus must include a counted cardEntries build');
const countedEntry = countedBuild.entries.find((entry) => entry.cardId.startsWith('U'));
assert(countedEntry, 'counted build must include a real unit entry');
countedEntry.count = context.cards.get(countedEntry.cardId).copyLimit + 1;
assert.throws(() => validateBuild(countedBuild, context), /copyLimit/);
negativeCases += 1;

const summaryByTarget = Object.fromEntries(BUILD_TARGETS.map((target) => [
  target,
  corpus.coverage.targetCounts.get(target),
]));
const professions = Object.fromEntries([...corpus.coverage.professionCounts.entries()].sort());
const races = Object.fromEntries([...corpus.coverage.raceCounts.entries()].sort());
const totalDeployed = simulations.reduce((sum, result) => sum + result.runs[0].deployedUnits, 0);
const totalEffects = simulations.reduce((sum, result) => sum + result.runs[0].effectApplications, 0);

console.log(`T255 build simulation PASS: targets=${BUILD_TARGETS.length}, builds=${corpus.builds.length}, professions=${JSON.stringify(professions)}, races=${JSON.stringify(races)}, targetCoverage=${JSON.stringify(summaryByTarget)}, seeds=3, deployedUnits=${totalDeployed}, effectApplications=${totalEffects}, negative-cases=${negativeCases}`);
