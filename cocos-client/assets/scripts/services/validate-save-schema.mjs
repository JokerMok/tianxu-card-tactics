import assert from 'node:assert/strict';
import { createDefaultSave, encodeSave, recoverSave, validateSave } from './SaveSchema.ts';

const primary = createDefaultSave('P001', 100);
assert.equal(validateSave(primary).schemaVersion, 1);
assert.equal(JSON.parse(encodeSave(primary)).playerId, 'P001');
assert.equal(recoverSave(primary, null, 'P001').reason, 'primary');
assert.equal(recoverSave({ schemaVersion: 99 }, primary, 'P001').reason, 'backup');
assert.equal(recoverSave({ schemaVersion: 99 }, { schemaVersion: 99 }, 'P001', 200).reason, 'default');
assert.throws(() => validateSave({ ...primary, unknown: true }), /unknown save field/);
assert.throws(() => validateSave({ ...primary, resources: { gold: -1, essence: 0 } }), /resources are invalid/);
console.log('T014 save schema PASS: default, validation, backup recovery and corruption fallback');
