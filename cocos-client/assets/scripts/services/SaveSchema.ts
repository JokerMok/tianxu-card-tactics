export const CURRENT_SAVE_VERSION = 1;

export interface SaveData {
  schemaVersion: number;
  playerId: string;
  updatedAt: number;
  deck: { cardIds: string[] };
  progress: { unlockedNodes: string[]; clearedNodes: string[] };
  resources: { gold: number; essence: number };
}

export interface SaveRecoveryResult {
  data: SaveData;
  recovered: boolean;
  reason: 'default' | 'backup' | 'primary';
  error?: string;
}

export function createDefaultSave(playerId: string, now = Date.now()): SaveData {
  return {
    schemaVersion: CURRENT_SAVE_VERSION,
    playerId,
    updatedAt: now,
    deck: { cardIds: [] },
    progress: { unlockedNodes: ['N001'], clearedNodes: [] },
    resources: { gold: 0, essence: 0 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  if (!isRecord(child)) throw new Error(`save.${key} must be an object`);
  return child;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${path} must be a non-empty string array`);
  }
  return [...value];
}

export function validateSave(value: unknown): SaveData {
  if (!isRecord(value)) throw new Error('save must be an object');
  if (value.schemaVersion !== CURRENT_SAVE_VERSION) throw new Error('unsupported schemaVersion');
  if (typeof value.playerId !== 'string' || value.playerId.length === 0) throw new Error('playerId is required');
  if (typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) throw new Error('updatedAt is invalid');
  const deck = requiredRecord(value, 'deck');
  const progress = requiredRecord(value, 'progress');
  const resources = requiredRecord(value, 'resources');
  const gold = resources.gold;
  const essence = resources.essence;
  if (![gold, essence].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) throw new Error('resources are invalid');
  if (Object.keys(value).some((key) => !['schemaVersion', 'playerId', 'updatedAt', 'deck', 'progress', 'resources'].includes(key))) throw new Error('unknown save field');
  return {
    schemaVersion: CURRENT_SAVE_VERSION,
    playerId: value.playerId,
    updatedAt: value.updatedAt,
    deck: { cardIds: stringArray(deck.cardIds, 'deck.cardIds') },
    progress: {
      unlockedNodes: stringArray(progress.unlockedNodes, 'progress.unlockedNodes'),
      clearedNodes: stringArray(progress.clearedNodes, 'progress.clearedNodes'),
    },
    resources: { gold, essence },
  };
}

export function encodeSave(data: SaveData): string {
  return JSON.stringify(validateSave(data));
}

export function recoverSave(primary: unknown, backup: unknown, playerId: string, now = Date.now()): SaveRecoveryResult {
  try { return { data: validateSave(primary), recovered: false, reason: 'primary' }; }
  catch (primaryError) {
    try { return { data: validateSave(backup), recovered: true, reason: 'backup', error: String(primaryError) }; }
    catch (backupError) { return { data: createDefaultSave(playerId, now), recovered: true, reason: 'default', error: `${String(primaryError)}; ${String(backupError)}` }; }
  }
}
