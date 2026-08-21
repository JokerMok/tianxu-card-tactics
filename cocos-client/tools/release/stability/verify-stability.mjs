import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_ROOT = path.resolve(import.meta.dirname, '../../..');
const RESOURCE_ROOT = path.join(CLIENT_ROOT, 'assets', 'resources');
const CONFIG_ROOT = path.join(RESOURCE_ROOT, 'config');
const MANIFEST_PATH = path.join(CONFIG_ROOT, 'manifest.json');
const CHAPTER_INDEX_PATH = path.join(CONFIG_ROOT, 'levels', 'chapter01', 'index.json');
const A0_MANIFEST_PATH = path.join(CLIENT_ROOT, 'assets', 'a0-manifest.json');
const R2_STABILITY_SCRIPT = path.join(CLIENT_ROOT, 'tools', 'test-r2-stability.mjs');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields must match the release contract`);
}

function readJson(filePath, label) {
  assert(path.isAbsolute(filePath), `${label} path must be absolute`);
  const source = fs.readFileSync(filePath, 'utf8');
  assert(source.trim().length > 0, `${label} must not be empty`);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readDeclaredResource(resource, label) {
  assert(typeof resource === 'string' && resource.startsWith('config/'), `${label} must be a config resource path`);
  assert(!resource.includes('..'), `${label} must not escape the resource root`);
  const filePath = path.join(RESOURCE_ROOT, `${resource}.json`);
  return readJson(filePath, label);
}

function validateConfigManifest(manifest) {
  exactKeys(manifest, ['schemaVersion', 'id', 'evidenceLevel', 'version', 'enabled', 'tables', 'chapters', 'idPolicy', 'evidenceLevels'], 'config manifest');
  assert.equal(manifest.schemaVersion, 1, 'config manifest schemaVersion must remain 1');
  assert.equal(manifest.id, 'CONFIG-MANIFEST', 'config manifest id must remain stable');
  assert.equal(manifest.evidenceLevel, 'C', 'config manifest evidenceLevel must remain C');
  assert(Number.isSafeInteger(manifest.version) && manifest.version > 0, 'config manifest version must be a positive integer');
  assert.equal(manifest.enabled, true, 'config manifest must be enabled');
  exactKeys(manifest.tables, ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks', 'strategies'], 'config manifest tables');
  exactKeys(manifest.chapters, ['chapter01'], 'config manifest chapters');
  exactKeys(manifest.idPolicy, ['scope', 'format', 'stable', 'unique'], 'config manifest idPolicy');
  assert.equal(manifest.idPolicy.scope, 'global', 'config id policy scope must be global');
  assert.equal(manifest.idPolicy.stable, true, 'config ids must be stable');
  assert.equal(manifest.idPolicy.unique, true, 'config ids must be unique');
  assert.equal(typeof manifest.idPolicy.format, 'string', 'config id policy format must be a string');
  assert.doesNotThrow(() => new RegExp(manifest.idPolicy.format), 'config id policy format must compile');
  assert.deepEqual(manifest.evidenceLevels, ['A', 'B', 'C'], 'config evidence levels must remain ordered');

  const declaredResources = [
    ...Object.entries(manifest.tables).map(([key, resource]) => [`tables.${key}`, resource]),
    ['chapters.chapter01', manifest.chapters.chapter01],
  ];
  const resources = new Map(declaredResources.map(([label, resource]) => [label, readDeclaredResource(resource, `real ${label}`)]));
  return { idPattern: new RegExp(manifest.idPolicy.format), resources };
}

function validateChapterIndex(index, idPattern, strategies) {
  exactKeys(index, ['schemaVersion', 'id', 'chapterId', 'levels', 'targetIds', 'rewardRegistries'], 'chapter01 index');
  assert.equal(index.schemaVersion, 1, 'chapter01 index schemaVersion must remain 1');
  assert.equal(index.id, 'CHAPTER01-LEVEL-INDEX', 'chapter01 index id must remain stable');
  assert.equal(index.chapterId, 'CHAPTER01', 'chapter01 id must remain stable');
  assert(Array.isArray(index.levels) && index.levels.length === 12, 'chapter01 must expose exactly 12 levels');
  assert(Array.isArray(index.targetIds) && index.targetIds.length === 10, 'chapter01 must expose exactly 10 targets');
  assert.deepEqual(Object.keys(index.rewardRegistries).sort(), ['chestIds', 'flagIds', 'unlockIds'], 'chapter01 reward registries must remain complete');

  const expectedLevelIds = Array.from({ length: 12 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`);
  const levelIds = index.levels.map((level) => level.id);
  assert.deepEqual(levelIds, expectedLevelIds, 'chapter01 levels must remain contiguous L01-L12');
  assert.equal(new Set(levelIds).size, levelIds.length, 'chapter01 level ids must be unique');
  index.levels.forEach((level, levelIndex) => {
    exactKeys(level, ['id', 'resource', 'prerequisiteLevelId', 'enemyStrategyId'], `chapter01 levels[${levelIndex}]`);
    assert.equal(level.resource, `config/levels/chapter01/${level.id}`, `chapter01 ${level.id} resource must be stable`);
    assert.equal(level.prerequisiteLevelId, levelIndex === 0 ? null : expectedLevelIds[levelIndex - 1], `chapter01 ${level.id} prerequisite must form a chain`);
    assert(strategies.has(level.enemyStrategyId), `chapter01 ${level.id} must reference a real enemy strategy`);
    assert(idPattern.test(level.id), `chapter01 ${level.id} must satisfy the real id policy`);
    readDeclaredResource(level.resource, `real chapter01 ${level.id}`);
  });
  for (const targetId of index.targetIds) assert(idPattern.test(targetId), `chapter01 target ${targetId} must satisfy the real id policy`);
  for (const [registryName, ids] of Object.entries(index.rewardRegistries)) {
    assert(Array.isArray(ids) && ids.length > 0, `chapter01 ${registryName} must be non-empty`);
    assert.equal(new Set(ids).size, ids.length, `chapter01 ${registryName} must not contain duplicates`);
    for (const id of ids) assert(idPattern.test(id), `chapter01 ${registryName} id ${id} must satisfy the real id policy`);
  }
}

function validateA0Manifest(manifest) {
  exactKeys(manifest, ['version', 'engine', 'target', 'designResolution', 'board', 'commanders', 'runtimeArt', 'metaGame', 'stress', 'scope'], 'A0 manifest');
  assert.equal(manifest.engine, 'Cocos Creator 3.8.8', 'A0 engine version must remain pinned');
  assert.equal(manifest.target, 'web-desktop', 'A0 target must remain web-desktop');
  assert.deepEqual(manifest.designResolution, [1920, 1080], 'A0 design resolution must remain 1920x1080');
  exactKeys(manifest.board, ['lanes', 'cellsPerLane', 'summonDepth', 'cellOccupancyLimit'], 'A0 board');
  assert.equal(manifest.board.lanes * manifest.board.cellsPerLane, 24, 'A0 board must expose 24 cells');
  assert.equal(manifest.board.summonDepth * manifest.board.lanes, 6, 'A0 summon depth must expose six legal deployment cells');
  assert.equal(manifest.board.cellOccupancyLimit, 1, 'A0 cell occupancy limit must remain one');
  exactKeys(manifest.commanders, ['count', 'fixedOutsideGrid', 'centerTolerancePx', 'visuals', 'backgroundless', 'preserveSourceAspectRatio', 'animationContract'], 'A0 commanders');
  assert.equal(manifest.commanders.count, 2, 'A0 must keep two commanders');
  assert.equal(manifest.commanders.fixedOutsideGrid, true, 'A0 commanders must remain outside the grid');
  assert.equal(manifest.commanders.preserveSourceAspectRatio, true, 'A0 commander aspect ratio must be preserved');
  assert.equal(manifest.commanders.animationContract.length, 6, 'A0 commander animation contract must remain complete');
  exactKeys(manifest.stress, ['units', 'targetFps', 'minimumFps', 'maximumP95FrameTimeMs'], 'A0 stress');
  assert.equal(manifest.stress.units, 24, 'A0 stress sample must contain 24 units');
  assert(Number.isFinite(manifest.stress.targetFps) && manifest.stress.targetFps >= 60, 'A0 target FPS must be at least 60');
  assert(Number.isFinite(manifest.stress.minimumFps) && manifest.stress.minimumFps >= 55 && manifest.stress.minimumFps <= manifest.stress.targetFps, 'A0 minimum FPS must stay within 55..targetFps');
  assert(Number.isFinite(manifest.stress.maximumP95FrameTimeMs) && manifest.stress.maximumP95FrameTimeMs <= 22, 'A0 P95 frame budget must not exceed 22ms');
}

function parseR2Metrics(output) {
  const line = output.split('\n').find((candidate) => candidate.startsWith('T215 R2 stability PASS:'));
  assert(line, 'R2 stability harness must emit its measured PASS line');
  return Object.fromEntries([...line.matchAll(/(\w+)=([0-9]+)/g)].map(([, key, value]) => [key, Number(value)]));
}

function runR2StabilityHarness() {
  assert(fs.statSync(R2_STABILITY_SCRIPT).isFile(), 'R2 stability harness must be a real file');
  const result = spawnSync(process.execPath, ['--experimental-strip-types', R2_STABILITY_SCRIPT], {
    cwd: CLIENT_ROOT,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `R2 stability harness must exit 0:\n${output}`);
  const metrics = parseR2Metrics(output);
  assert(metrics.ticks >= 1_800, 'R2 stability harness must cover at least 1,800 ticks');
  assert(metrics.battles >= 60, 'R2 stability harness must cover at least 60 battles');
  assert(metrics.checkpoints >= 2, 'R2 stability harness must restore at least two checkpoints');
  assert(metrics.rollbackChecks >= 7, 'R2 stability harness must cover all stateful rollback paths');
  assert(metrics.negativeCases >= 15, 'R2 stability harness must retain meaningful negative-case coverage');
  assert(metrics.recoveredExceptions >= 2, 'R2 stability harness must cover exception recovery');
  console.log(`  positive PASS: R2 long-run harness (${metrics.ticks} ticks, ${metrics.battles} battles, ${metrics.rollbackChecks} rollback checks, ${metrics.negativeCases} negative cases)`);
  return { metrics, output };
}

function expectRejected(label, action, pattern) {
  assert.throws(action, pattern, `${label} must be rejected`);
  console.log(`  negative PASS: ${label}`);
}

function runCounterexamples(realManifest, realA0Manifest, realChapterIndex, idPattern, strategies) {
  expectRejected('missing real manifest file', () => readJson(path.join(CONFIG_ROOT, 'manifest.missing.json'), 'missing real manifest'), /ENOENT/);

  const invalidManifest = structuredClone(realManifest);
  invalidManifest.enabled = 'true';
  expectRejected('invalid manifest enabled type', () => validateConfigManifest(invalidManifest), /enabled/);

  const outOfRangeA0Manifest = structuredClone(realA0Manifest);
  outOfRangeA0Manifest.stress.minimumFps = outOfRangeA0Manifest.stress.targetFps + 1;
  expectRejected('out-of-range A0 minimum FPS', () => validateA0Manifest(outOfRangeA0Manifest), /minimum FPS/);

  const brokenChapter = structuredClone(realManifest);
  brokenChapter.tables.cards = 'config/cards-missing';
  expectRejected('missing declared real resource', () => {
    const candidate = validateConfigManifest(brokenChapter);
    readDeclaredResource(brokenChapter.tables.cards, 'missing declared cards table');
    return candidate;
  }, /ENOENT/);

  const brokenLevel = structuredClone(realChapterIndex);
  brokenLevel.levels[1].prerequisiteLevelId = 'L12';
  expectRejected('out-of-order chapter prerequisite', () => validateChapterIndex(brokenLevel, idPattern, strategies), /prerequisite/);
}

function main() {
  const realManifest = readJson(MANIFEST_PATH, 'real config manifest');
  const { idPattern, resources } = validateConfigManifest(realManifest);
  const declaredChapterIndex = resources.get('chapters.chapter01');
  const realChapterIndex = readJson(CHAPTER_INDEX_PATH, 'real chapter01 index');
  assert.deepEqual(realChapterIndex, declaredChapterIndex, 'manifest chapter resource must match the real chapter index file');
  const realStrategies = resources.get('tables.strategies');
  const strategies = new Set(realStrategies.strategies.map(({ id }) => id));
  assert(strategies.size === realStrategies.strategies.length, 'real enemy strategy ids must be unique');
  validateChapterIndex(realChapterIndex, idPattern, strategies);

  const realA0Manifest = readJson(A0_MANIFEST_PATH, 'real A0 manifest');
  validateA0Manifest(realA0Manifest);

  console.log(`T326 real release contracts: PASS (manifest tables=${Object.keys(realManifest.tables).length}, levels=${realChapterIndex.levels.length}, real chapter resources=${realChapterIndex.levels.length}, A0 stress units=${realA0Manifest.stress.units})`);
  const harness = runR2StabilityHarness();
  runCounterexamples(realManifest, realA0Manifest, realChapterIndex, idPattern, strategies);
  console.log('T326 stability rehearsal: PASS (real files, long-run sample, missing/invalid/out-of-range counterexamples, rollback evidence)');
  console.log(`T326 conclusion: release gate is green; R2 checkpoints=${harness.metrics.checkpoints}, recoveredExceptions=${harness.metrics.recoveredExceptions}`);
}

main();
