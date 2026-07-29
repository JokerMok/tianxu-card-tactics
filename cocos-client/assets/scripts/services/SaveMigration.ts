import { createDefaultSave, encodeSave, validateSave, type SaveData } from './SaveSchema.ts';

export interface MigrationResult {
  data: SaveData;
  backup: string;
  migrated: boolean;
  source: 'primary' | 'backup' | 'default';
  error?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('legacy save must be an object');
  return value as Record<string, unknown>;
}

function array(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('legacy card/node list is invalid');
  return [...value];
}

export function migrateV1(input: unknown, playerId: string, now = Date.now()): SaveData {
  const raw = record(input);
  if (raw.schemaVersion === 1) return validateSave(raw);
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 0) throw new Error('unsupported legacy schema');
  const legacyDeck = raw.deck;
  const legacyProgress = raw.progress;
  const legacyResources = raw.resources;
  const deck = Array.isArray(legacyDeck) ? legacyDeck : record(legacyDeck ?? {});
  const progress = record(legacyProgress ?? {});
  const resources = record(legacyResources ?? {});
  const cardIds = array(deck.cardIds ?? deck.cards ?? raw.cardIds ?? []);
  const unlockedNodes = array(progress.unlockedNodes ?? raw.unlockedNodes ?? ['N001']);
  const clearedNodes = array(progress.clearedNodes ?? raw.clearedNodes ?? []);
  const gold = resources.gold ?? raw.gold ?? 0;
  const essence = resources.essence ?? raw.essence ?? 0;
  return validateSave({
    schemaVersion: 1,
    playerId: typeof raw.playerId === 'string' ? raw.playerId : playerId,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    deck: { cardIds }, progress: { unlockedNodes, clearedNodes }, resources: { gold, essence },
  });
}

export function migrateWithBackup(primary: unknown, backup: unknown, playerId: string, now = Date.now()): MigrationResult {
  const backupText = typeof primary === 'string' ? primary : JSON.stringify(primary);
  try { return { data: migrateV1(typeof primary === 'string' ? JSON.parse(primary) : primary, playerId, now), backup: backupText, migrated: true, source: 'primary' }; }
  catch (primaryError) {
    try { return { data: migrateV1(typeof backup === 'string' ? JSON.parse(backup) : backup, playerId, now), backup: backupText, migrated: true, source: 'backup', error: String(primaryError) }; }
    catch (backupError) {
      return { data: createDefaultSave(playerId, now), backup: backupText, migrated: false, source: 'default', error: `${String(primaryError)}; ${String(backupError)}` };
    }
  }
}

export function serializeMigration(result: MigrationResult): { save: string; backup: string } {
  return { save: encodeSave(result.data), backup: result.backup };
}
