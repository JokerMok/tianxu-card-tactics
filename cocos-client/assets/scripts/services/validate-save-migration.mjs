import assert from 'node:assert/strict';
import { migrateV1, migrateWithBackup, serializeMigration } from './SaveMigration.ts';

const old = { playerId: 'P001', cardIds: ['U001'], gold: 9, essence: 2, unlockedNodes: ['N001', 'N002'], updatedAt: 10 };
const migrated = migrateV1(old, 'P001', 20);
assert.equal(migrated.schemaVersion, 1); assert.deepEqual(migrated.deck.cardIds, ['U001']); assert.equal(migrated.resources.gold, 9);
const result = migrateWithBackup('{bad-json', old, 'P001', 20);
assert.equal(result.source, 'backup'); assert.equal(result.backup, '{bad-json');
const fallback = migrateWithBackup('{bad-json', '{also-bad}', 'P001', 20);
assert.equal(fallback.source, 'default'); assert.equal(fallback.migrated, false);
const serialized = serializeMigration({ data: migrated, backup: JSON.stringify(old), migrated: true, source: 'primary' });
assert.equal(JSON.parse(serialized.save).schemaVersion, 1); assert.equal(serialized.backup, JSON.stringify(old));
console.log('T015 migration PASS: v1 migration, backup retention and corruption fallback');
