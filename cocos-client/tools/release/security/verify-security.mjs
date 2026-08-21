import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(toolRoot, '../../..');
const resourceRoot = path.join(clientRoot, 'assets', 'resources');
const sampleRoot = path.join(toolRoot, 'samples');

const targetFiles = Object.freeze({
  a0Manifest: path.join(clientRoot, 'assets', 'a0-manifest.json'),
  configManifest: path.join(resourceRoot, 'config', 'manifest.json'),
  configLoader: path.join(clientRoot, 'assets', 'scripts', 'config', 'ConfigLoader.ts'),
  configValidator: path.join(clientRoot, 'assets', 'scripts', 'config', 'ConfigValidator.ts'),
  saveSchema: path.join(clientRoot, 'assets', 'scripts', 'services', 'SaveSchema.ts'),
  rewardIsolation: path.join(clientRoot, 'assets', 'scripts', 'services', 'reward', 'isolation', 'PveRewardIsolationService.ts'),
});

const passSamplePath = path.join(sampleRoot, 'pass-release-security.json');
const failureSamplePath = path.join(sampleRoot, 'fail-tampered-save.json');
const invalidJsonSamplePath = path.join(sampleRoot, 'invalid-json.txt');

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields must match the release contract`);
}

function readRegularFile(filePath, label) {
  assert(path.isAbsolute(filePath), `${label} path must be absolute`);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file`);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJson(filePath, label) {
  const text = readRegularFile(filePath, label);
  if (text.trim().length === 0) fail(`${label} must not be empty`);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function resolveResourceFile(resourceRef, label) {
  if (
    typeof resourceRef !== 'string'
    || !resourceRef.startsWith('config/')
    || resourceRef.includes('..')
    || resourceRef.includes('\\')
    || path.posix.isAbsolute(resourceRef)
  ) {
    fail(`${label} must be a safe config resource path`);
  }
  const filePath = path.resolve(resourceRoot, `${resourceRef}.json`);
  if (!isWithin(resourceRoot, filePath)) fail(`${label} escapes the resources root`);
  return filePath;
}

function expectFailure(label, action, expectedMessage) {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, expectedMessage, `${label} returned an unexpected rejection`);
    console.log(`  negative PASS: ${label}`);
    return;
  }
  fail(`${label} was accepted unexpectedly`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadProductionConfigContract(loaderSource) {
  const sourceWithStub = loaderSource.replace(
    "import { JsonAsset, resources } from 'cc';",
    "const JsonAsset = class JsonAsset {}; const resources = { load() { throw new Error('Cocos resources are unavailable in the release verifier'); } };",
  );
  assert.notEqual(sourceWithStub, loaderSource, 'ConfigLoader must retain its expected Cocos import boundary');
  const executableSource = stripTypeScriptTypes(sourceWithStub, { mode: 'transform' });
  const encoded = Buffer.from(executableSource, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#T328-ConfigLoader`);
}

function assertReleaseManifest(manifest, configContract) {
  configContract.assertConfigManifest(manifest);
  exactKeys(manifest, [
    'schemaVersion', 'id', 'evidenceLevel', 'version', 'enabled', 'tables', 'chapters', 'idPolicy', 'evidenceLevels',
  ], 'real config manifest');
  assert.equal(manifest.id, 'CONFIG-MANIFEST', 'real config manifest id must remain stable');
  assert.equal(manifest.enabled, true, 'real config manifest must be enabled');
  assert.deepEqual(Object.keys(manifest.tables).sort(), ['cards', 'decks', 'effects', 'professions', 'skills', 'statuses', 'strategies', 'units']);
  assert.deepEqual(Object.keys(manifest.chapters), ['chapter01']);
  assert.deepEqual(manifest.evidenceLevels, ['A', 'B', 'C']);
}

function readDeclaredResources(manifest) {
  const declarations = [
    ...Object.entries(manifest.tables).map(([name, resource]) => [`tables.${name}`, resource]),
    ['chapters.chapter01', manifest.chapters.chapter01],
  ];
  const resources = new Map();
  for (const [label, resource] of declarations) {
    const filePath = resolveResourceFile(resource, `real ${label}`);
    resources.set(label, readJson(filePath, `real ${label}`));
  }
  return resources;
}

function assertProductionSourceContracts(sources) {
  const requiredPatterns = {
    configLoader: [
      /class ConfigLoadError extends Error/,
      /exactKeys\(/,
      /只允许加载/,
      /function loadJsonAsset\(/,
    ],
    configValidator: [
      /function boundedInteger\(/,
      /function assertReferences\(/,
      /function assertAcyclic\(/,
      /重复 ID/,
    ],
    saveSchema: [
      /Number\.isSafeInteger/,
      /unknown save field/,
      /export function recoverSave\(/,
      /reason: 'backup'/,
    ],
    rewardIsolation: [
      /const RESERVED_IDS = new Set/,
      /assertSettlementKeys\(/,
      /Object\.freeze\(/,
      /PERSISTENCE_REENTRANT/,
    ],
  };
  let checked = 0;
  for (const [name, patterns] of Object.entries(requiredPatterns)) {
    const source = sources[name];
    for (const pattern of patterns) {
      assert.match(source, pattern, `${name} must retain security boundary ${pattern}`);
      checked += 1;
    }
    assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/, `${name} must not use dynamic code execution`);
    assert.doesNotMatch(source, /child_process|process\.binding/, `${name} must not invoke host process primitives`);
  }
  return checked;
}

function validateA0Manifest(manifest) {
  exactKeys(manifest, [
    'version', 'engine', 'target', 'designResolution', 'board', 'commanders', 'runtimeArt', 'metaGame', 'stress', 'scope',
  ], 'real A0 manifest');
  assert.equal(manifest.engine, 'Cocos Creator 3.8.8');
  assert.equal(manifest.target, 'web-desktop');
  assert.deepEqual(manifest.designResolution, [1920, 1080]);
  assert.equal(manifest.metaGame.persistence, 'localStorage');
  assert.doesNotMatch(JSON.stringify(manifest), /(?:javascript:|data:text\/html|<script)/i, 'A0 manifest must not contain executable URL payloads');
}

function assertPassSample(passSample, fileContents) {
  exactKeys(passSample, ['kind', 'evidenceClass', 'scenario', 'save', 'expected', 'targetSha256'], 'pass sample');
  assert.equal(passSample.kind, 'release-security-pass-sample');
  assert.equal(passSample.evidenceClass, 'contract-rehearsal-fixture');
  exactKeys(passSample.expected, ['declaredResourceFiles', 'sourceBoundaryAssertions', 'primaryRecoveryReason'], 'pass sample expected');
  assert.equal(passSample.expected.declaredResourceFiles, 9);
  assert.equal(passSample.expected.sourceBoundaryAssertions, 16);
  assert.equal(passSample.expected.primaryRecoveryReason, 'primary');
  exactKeys(passSample.targetSha256, Object.keys(targetFiles), 'pass sample targetSha256');
  for (const [name, filePath] of Object.entries(targetFiles)) {
    assert.match(passSample.targetSha256[name], /^[0-9a-f]{64}$/, `pass sample hash for ${name} must be SHA-256`);
    assert.equal(passSample.targetSha256[name], sha256(fileContents[name]), `pass sample hash mismatch for ${name}`);
  }
}

async function runSaveRehearsal(passSample, failureSample) {
  const saveSchema = await import(pathToFileURL(targetFiles.saveSchema).href);
  assert.equal(saveSchema.CURRENT_SAVE_VERSION, 1, 'save schema version must remain 1');

  const validSave = saveSchema.validateSave(passSample.save);
  assert.equal(validSave.playerId, 'T328-PASS');
  assert.equal(saveSchema.recoverSave(validSave, validSave, 'T328-FALLBACK', 1700000000000).reason, 'primary');
  assert.doesNotThrow(() => JSON.parse(saveSchema.encodeSave(validSave)), 'valid save must encode as JSON');

  const outOfRangeSave = structuredClone(passSample.save);
  outOfRangeSave.resources.gold = Number.MAX_SAFE_INTEGER + 1;
  expectFailure('out-of-range save integer', () => saveSchema.validateSave(outOfRangeSave), /resources are invalid/);

  const recoveredFromBackup = saveSchema.recoverSave(outOfRangeSave, validSave, 'T328-FALLBACK', 1700000000000);
  assert.equal(recoveredFromBackup.recovered, true);
  assert.equal(recoveredFromBackup.reason, 'backup');
  assert.equal(recoveredFromBackup.data.playerId, 'T328-PASS');
  const recoveredDefault = saveSchema.recoverSave(outOfRangeSave, outOfRangeSave, 'T328-FALLBACK', 1700000000000);
  assert.equal(recoveredDefault.reason, 'default');
  assert.equal(recoveredDefault.data.playerId, 'T328-FALLBACK');
  console.log(`  positive PASS: SaveSchema real validation/recovery (primary=${validSave.playerId}, backup=${recoveredFromBackup.reason}, default=${recoveredDefault.reason})`);

  exactKeys(failureSample, ['kind', 'evidenceClass', 'scenario', 'expectedRejection', 'save'], 'failure sample');
  assert.equal(failureSample.kind, 'release-security-failure-sample');
  assert.equal(failureSample.evidenceClass, 'tampered-input');
  expectFailure(
    'real tampered save sample',
    () => saveSchema.validateSave(failureSample.save),
    new RegExp(escapeRegExp(failureSample.expectedRejection)),
  );
}

async function main() {
  const fileContents = Object.fromEntries(Object.entries(targetFiles).map(([name, filePath]) => [name, readRegularFile(filePath, `real ${name}`)]));
  const realA0Manifest = JSON.parse(fileContents.a0Manifest);
  const realConfigManifest = JSON.parse(fileContents.configManifest);
  const configContract = await loadProductionConfigContract(fileContents.configLoader);

  validateA0Manifest(realA0Manifest);
  assertReleaseManifest(realConfigManifest, configContract);
  const declaredResources = readDeclaredResources(realConfigManifest);
  const sourceBoundaryAssertions = assertProductionSourceContracts(fileContents);
  assert.equal(sourceBoundaryAssertions, 16);

  const passSample = readJson(passSamplePath, 'T328 pass sample');
  assertPassSample(passSample, fileContents);
  assert.equal(declaredResources.size, passSample.expected.declaredResourceFiles);
  const failureSample = readJson(failureSamplePath, 'T328 failure sample');

  console.log(`T328 real release security contracts: PASS (manifest tables=${Object.keys(realConfigManifest.tables).length}, declared resource files=${declaredResources.size}, source boundary assertions=${sourceBoundaryAssertions})`);
  console.log(`T328 pass sample: PASS (SHA-256 baselines=${Object.keys(fileContents).length}, evidence=${passSample.evidenceClass})`);
  await runSaveRehearsal(passSample, failureSample);

  expectFailure('missing real security sample file', () => readJson(path.join(sampleRoot, 'does-not-exist.json'), 'missing security sample'), /cannot be read|ENOENT/);
  expectFailure('invalid JSON sample', () => readJson(invalidJsonSamplePath, 'invalid JSON sample'), /not valid JSON/);

  const traversalManifest = structuredClone(realConfigManifest);
  traversalManifest.tables.cards = 'config/../a0-manifest';
  expectFailure('config resource path traversal', () => configContract.assertConfigManifest(traversalManifest), /只允许加载|cards/);
  expectFailure('resource resolver path traversal', () => resolveResourceFile('config/../a0-manifest', 'traversal resource'), /safe config resource path|escapes/);

  console.log('T328 counterexamples: PASS (missing file, invalid JSON, out-of-range integer, tampered save, config path traversal)');
  console.log('T328 conclusion: release security rehearsal PASS; covered release gate is green.');
  console.log('T328 rollback: stop release, save the current verifier/report/samples, git revert --no-edit 2b44a1f39e2e49f26916b4b9ef50725f01a78650 then git revert --no-edit 94f1363c190a8bb32214a6c534419b88450c3efe then git revert --no-edit 6943b5207361dfd037a4147ec34cb5d7ee530f59, rerun the verifier from the saved copy, record its exit code, and update no shared ledger until it passes.');
}

main().catch((error) => {
  console.error(`T328 verifier: FAIL (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
});
