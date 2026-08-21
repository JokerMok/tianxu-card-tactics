import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(toolRoot, '../../..');
const sampleRoot = path.join(toolRoot, 'samples');

const targetFiles = Object.freeze({
  saveSchema: path.join(clientRoot, 'assets', 'scripts', 'services', 'SaveSchema.ts'),
  saveMigration: path.join(clientRoot, 'assets', 'scripts', 'services', 'SaveMigration.ts'),
});

const passSamplePath = path.join(sampleRoot, 'pass-release-recovery.json');
const failureSamplePath = path.join(sampleRoot, 'fail-unrecoverable-save.json');
const invalidJsonSamplePath = path.join(sampleRoot, 'invalid-json.txt');

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} fields must match the recovery contract`);
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

function assertSourceContract(sourceTexts) {
  const requiredPatterns = {
    saveSchema: [
      /export function validateSave\(/,
      /export function recoverSave\(/,
      /Number\.isSafeInteger/,
      /reason: 'backup'/,
      /reason: 'default'/,
    ],
    saveMigration: [
      /export function migrateV1\(/,
      /export function migrateWithBackup\(/,
      /source: 'backup'/,
      /source: 'default'/,
    ],
  };
  let checked = 0;
  for (const [name, patterns] of Object.entries(requiredPatterns)) {
    for (const pattern of patterns) {
      assert.match(sourceTexts[name], pattern, `${name} must retain recovery boundary ${pattern}`);
      checked += 1;
    }
  }
  return checked;
}

function assertPassSample(sample, sourceTexts) {
  exactKeys(sample, [
    'kind', 'evidenceClass', 'scenario', 'now', 'primary', 'backup', 'invalidPrimary',
    'legacyPrimary', 'legacyBackup', 'expected', 'targetSha256',
  ], 'pass sample');
  assert.equal(sample.kind, 'release-recovery-pass-sample');
  assert.equal(sample.evidenceClass, 'contract-rehearsal-fixture');
  assert.equal(Number.isSafeInteger(sample.now), true);
  exactKeys(sample.expected, [
    'currentSchemaVersion', 'primaryReason', 'backupReason', 'defaultReason',
    'migrationSource', 'defaultPlayerId', 'backupPlayerId', 'legacyCardId',
  ], 'pass sample expected');
  exactKeys(sample.targetSha256, Object.keys(targetFiles), 'pass sample targetSha256');
  for (const [name, text] of Object.entries(sourceTexts)) {
    assert.match(sample.targetSha256[name], /^[0-9a-f]{64}$/, `pass sample hash for ${name} must be SHA-256`);
    assert.equal(sample.targetSha256[name], sha256(text), `pass sample hash mismatch for ${name}`);
  }
}

function assertFailureSample(sample) {
  exactKeys(sample, ['kind', 'evidenceClass', 'scenario', 'primary', 'backup', 'expected'], 'failure sample');
  assert.equal(sample.kind, 'release-recovery-failure-sample');
  assert.equal(sample.evidenceClass, 'corrupt-input');
  exactKeys(sample.expected, ['reason', 'recovered', 'playerId'], 'failure sample expected');
}

async function main() {
  const sourceTexts = Object.fromEntries(
    Object.entries(targetFiles).map(([name, filePath]) => [name, readRegularFile(filePath, `real ${name} source`)]),
  );
  const saveSchema = await import(pathToFileURL(targetFiles.saveSchema).href);
  const saveMigration = await import(pathToFileURL(targetFiles.saveMigration).href);
  const sourceBoundaryAssertions = assertSourceContract(sourceTexts);
  assert.equal(saveSchema.CURRENT_SAVE_VERSION, 1, 'real SaveSchema version must remain 1');

  const passSample = readJson(passSamplePath, 'T329 pass sample');
  assertPassSample(passSample, sourceTexts);
  const failureSample = readJson(failureSamplePath, 'T329 failure sample');
  assertFailureSample(failureSample);

  const primary = saveSchema.validateSave(passSample.primary);
  assert.equal(primary.schemaVersion, passSample.expected.currentSchemaVersion);
  assert.equal(primary.playerId, 'T329-PASS');
  assert.equal(primary.pveRewardIsolation.schemaVersion, 1, 'v1 save must migrate missing PVE shards in memory');
  assert.equal(JSON.parse(saveSchema.encodeSave(primary)).playerId, primary.playerId);

  const primaryRecovery = saveSchema.recoverSave(
    passSample.primary,
    passSample.backup,
    passSample.expected.defaultPlayerId,
    passSample.now,
  );
  assert.equal(primaryRecovery.reason, passSample.expected.primaryReason);
  assert.equal(primaryRecovery.recovered, false);
  assert.equal(primaryRecovery.data.playerId, primary.playerId);

  const backupRecovery = saveSchema.recoverSave(
    passSample.invalidPrimary,
    passSample.backup,
    passSample.expected.defaultPlayerId,
    passSample.now,
  );
  assert.equal(backupRecovery.reason, passSample.expected.backupReason);
  assert.equal(backupRecovery.recovered, true);
  assert.equal(backupRecovery.data.playerId, passSample.expected.backupPlayerId);

  const failureRecovery = saveSchema.recoverSave(
    failureSample.primary,
    failureSample.backup,
    failureSample.expected.playerId,
    passSample.now,
  );
  assert.equal(failureRecovery.reason, passSample.expected.defaultReason);
  assert.equal(failureRecovery.reason, failureSample.expected.reason);
  assert.equal(failureRecovery.recovered, failureSample.expected.recovered);
  assert.equal(failureRecovery.data.playerId, failureSample.expected.playerId);
  assert.equal(failureRecovery.data.schemaVersion, passSample.expected.currentSchemaVersion);
  assert.equal(failureRecovery.data.updatedAt, passSample.now);
  assert.match(failureRecovery.error ?? '', /save must be an object/);
  assert.match(failureRecovery.error ?? '', /unsupported schemaVersion/);
  console.log(`T329 SaveSchema recovery: PASS (primary=${primaryRecovery.reason}, backup=${backupRecovery.reason}, corrupt primary+backup=${failureRecovery.reason})`);

  const migration = saveMigration.migrateWithBackup(
    passSample.legacyPrimary,
    passSample.legacyBackup,
    passSample.expected.defaultPlayerId,
    passSample.now,
  );
  assert.equal(migration.source, passSample.expected.migrationSource);
  assert.equal(migration.migrated, true);
  assert.equal(migration.data.deck.cardIds[0], passSample.expected.legacyCardId);
  assert.equal(migration.data.schemaVersion, passSample.expected.currentSchemaVersion);
  assert.equal(migration.backup, passSample.legacyPrimary);

  const migrationDefault = saveMigration.migrateWithBackup(
    failureSample.primary,
    failureSample.backup,
    failureSample.expected.playerId,
    passSample.now,
  );
  assert.equal(migrationDefault.source, passSample.expected.defaultReason);
  assert.equal(migrationDefault.migrated, false);
  assert.equal(migrationDefault.data.playerId, failureSample.expected.playerId);
  console.log(`T329 SaveMigration recovery: PASS (corrupt primary -> ${migration.source}, corrupt primary+backup -> ${migrationDefault.source})`);

  expectFailure('missing recovery sample file', () => readJson(path.join(sampleRoot, 'does-not-exist.json'), 'missing recovery sample'), /cannot be read|ENOENT/);
  expectFailure('invalid JSON recovery sample', () => readJson(invalidJsonSamplePath, 'invalid JSON recovery sample'), /not valid JSON/);

  const unknownField = structuredClone(passSample.primary);
  unknownField.recoveryMarker = true;
  expectFailure('unknown save field', () => saveSchema.validateSave(unknownField), /unknown save field/);

  const unsupportedVersion = structuredClone(passSample.primary);
  unsupportedVersion.schemaVersion = 99;
  expectFailure('unsupported save schema version', () => saveSchema.validateSave(unsupportedVersion), /unsupported schemaVersion/);

  const outOfRangeTimestamp = structuredClone(passSample.primary);
  outOfRangeTimestamp.updatedAt = Number.MAX_SAFE_INTEGER + 1;
  expectFailure('out-of-range save timestamp', () => saveSchema.validateSave(outOfRangeTimestamp), /updatedAt is invalid/);

  const negativeResource = structuredClone(passSample.primary);
  negativeResource.resources.gold = -1;
  expectFailure('negative resource balance', () => saveSchema.validateSave(negativeResource), /resources are invalid/);

  console.log('T329 counterexamples: PASS (missing file, invalid JSON, unknown field, unsupported version, timestamp/resource bounds)');
  console.log(`T329 source reads: PASS (SaveSchema bytes=${sourceTexts.saveSchema.length}, SaveMigration bytes=${sourceTexts.saveMigration.length}, assertions=${sourceBoundaryAssertions})`);
  console.log('T329 conclusion: release recovery rehearsal PASS; primary, backup, default and legacy migration paths are verified by real production code.');
  console.log('T329 rollback: stop release, preserve output, git revert <T329 commit SHA>, then rerun this command before updating the shared ledger.');
}

main().catch((error) => {
  console.error(`T329 verifier: FAIL (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
});
