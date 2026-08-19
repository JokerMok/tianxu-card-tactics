import { JsonAsset, resources } from 'cc';
import type { ChapterLevelConfig, ChapterLevelReferences } from './levels/ChapterLevelContract';

export type EvidenceLevel = 'A' | 'B' | 'C';

export interface ConfigManifest {
  schemaVersion: 1;
  id: string;
  evidenceLevel: EvidenceLevel;
  version: number;
  enabled: boolean;
  tables: {
    units: string;
    cards: string;
    skills: string;
    effects: string;
    statuses: string;
    professions: string;
    decks: string;
  };
  chapters: {
    chapter01: string;
  };
  idPolicy: {
    scope: string;
    format: string;
    stable: boolean;
    unique: boolean;
  };
  evidenceLevels: EvidenceLevel[];
}

export interface ChapterLevelIndexEntry {
  id: string;
  resource: string;
  prerequisiteLevelId: string | null;
}

export interface ChapterLevelIndex {
  schemaVersion: 1;
  id: string;
  chapterId: string;
  levels: ChapterLevelIndexEntry[];
  targetIds: string[];
  rewardRegistries: {
    unlockIds: string[];
    chestIds: string[];
    flagIds: string[];
  };
}

const CHAPTER01_INDEX_PATH = 'config/levels/chapter01/index';
const CHAPTER_INDEX_LEVEL_ID = /^L(?:0[1-9]|1[0-2])$/;

export class ConfigLoadError extends Error {
  constructor(public readonly configPath: string, message: string, options?: { cause?: unknown }) {
    super(`配置加载失败 [${configPath}]: ${message}`);
    this.name = 'ConfigLoadError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function required(record: Record<string, unknown>, key: string, configPath: string): unknown {
  if (!(key in record)) throw new ConfigLoadError(`${configPath}.${key}`, '缺少必需字段');
  return record[key];
}

function booleanField(record: Record<string, unknown>, key: string, configPath: string): boolean {
  const value = required(record, key, configPath);
  if (typeof value !== 'boolean') throw new ConfigLoadError(`${configPath}.${key}`, '必须是 boolean');
  return value;
}

function stringField(record: Record<string, unknown>, key: string, configPath: string): string {
  const value = required(record, key, configPath);
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigLoadError(`${configPath}.${key}`, '必须是非空 string');
  }
  return value;
}

function evidenceLevel(value: unknown, configPath: string): EvidenceLevel {
  if (value !== 'A' && value !== 'B' && value !== 'C') {
    throw new ConfigLoadError(configPath, '必须是 A、B 或 C');
  }
  return value;
}

function loadJsonAsset(configPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resources.load(configPath, JsonAsset, (error, asset) => {
      if (error) {
        reject(new ConfigLoadError(configPath, error.message || '资源读取失败', { cause: error }));
        return;
      }
      resolve(asset?.json);
    });
  });
}

function assertTable(value: unknown, tableName: string, configPath: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  if (value.table !== tableName) throw new ConfigLoadError(`${configPath}.table`, `必须是 ${tableName}`);
  const rows = value[tableName];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ConfigLoadError(`${configPath}.${tableName}`, '必须是非空 array');
  }
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id.length === 0) {
      throw new ConfigLoadError(`${configPath}.${tableName}[${index}].id`, '必须是非空 string');
    }
    if (ids.has(row.id)) {
      throw new ConfigLoadError(`${configPath}.${tableName}[${index}].id`, `重复 ID: ${row.id}`);
    }
    ids.add(row.id);
  });
  return value;
}

export function isConfigManifest(value: unknown): value is ConfigManifest {
  try {
    assertConfigManifest(value);
    return true;
  } catch {
    return false;
  }
}

export function assertConfigManifest(value: unknown, configPath = 'config/manifest'): asserts value is ConfigManifest {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');

  const schemaVersion = required(value, 'schemaVersion', configPath);
  if (schemaVersion !== 1) throw new ConfigLoadError(`${configPath}.schemaVersion`, '必须是数字 1');
  stringField(value, 'id', configPath);
  evidenceLevel(required(value, 'evidenceLevel', configPath), `${configPath}.evidenceLevel`);
  const version = required(value, 'version', configPath);
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ConfigLoadError(`${configPath}.version`, '必须是正整数');
  }
  booleanField(value, 'enabled', configPath);

  const tablesPath = `${configPath}.tables`;
  const tables = required(value, 'tables', configPath);
  if (!isRecord(tables)) throw new ConfigLoadError(tablesPath, '必须是 object');
  stringField(tables, 'units', tablesPath);
  stringField(tables, 'cards', tablesPath);
  const expectedTables = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks'] as const;
  for (const tableName of expectedTables) {
    const tablePath = stringField(tables, tableName, tablesPath);
    if (tablePath !== `config/${tableName}`) {
      throw new ConfigLoadError(`${tablesPath}.${tableName}`, `只允许加载 config/${tableName}`);
    }
  }

  const chaptersPath = `${configPath}.chapters`;
  const chapters = required(value, 'chapters', configPath);
  if (!isRecord(chapters)) throw new ConfigLoadError(chaptersPath, '必须是 object');
  const chapter01Path = stringField(chapters, 'chapter01', chaptersPath);
  if (chapter01Path !== CHAPTER01_INDEX_PATH) {
    throw new ConfigLoadError(`${chaptersPath}.chapter01`, `只允许加载 ${CHAPTER01_INDEX_PATH}`);
  }

  const policyPath = `${configPath}.idPolicy`;
  const policy = required(value, 'idPolicy', configPath);
  if (!isRecord(policy)) throw new ConfigLoadError(policyPath, '必须是 object');
  stringField(policy, 'scope', policyPath);
  stringField(policy, 'format', policyPath);
  booleanField(policy, 'stable', policyPath);
  booleanField(policy, 'unique', policyPath);

  const levelsPath = `${configPath}.evidenceLevels`;
  const levels = required(value, 'evidenceLevels', configPath);
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new ConfigLoadError(levelsPath, '必须是非空 array');
  }
  levels.forEach((level, index) => evidenceLevel(level, `${levelsPath}[${index}]`));
}

function assertIndexStringArray(value: unknown, configPath: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new ConfigLoadError(configPath, '必须是非空 string 数组');
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    if (ids.has(item)) throw new ConfigLoadError(`${configPath}[${index}]`, `重复 ID: ${item}`);
    ids.add(item);
  });
  return value as string[];
}

function assertChapterLevelIndex(value: unknown, configPath = CHAPTER01_INDEX_PATH): ChapterLevelIndex {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  if (required(value, 'schemaVersion', configPath) !== 1) {
    throw new ConfigLoadError(`${configPath}.schemaVersion`, '必须是数字 1');
  }
  if (stringField(value, 'id', configPath) !== 'CHAPTER01-LEVEL-INDEX') {
    throw new ConfigLoadError(`${configPath}.id`, '必须是 CHAPTER01-LEVEL-INDEX');
  }
  if (stringField(value, 'chapterId', configPath) !== 'CHAPTER01') {
    throw new ConfigLoadError(`${configPath}.chapterId`, '必须是 CHAPTER01');
  }

  const levelsPath = `${configPath}.levels`;
  const levels = required(value, 'levels', configPath);
  if (!Array.isArray(levels) || levels.length !== 12) {
    throw new ConfigLoadError(levelsPath, '必须按 L01 至 L12 提供 12 个关卡');
  }
  const ids = new Set<string>();
  levels.forEach((entry, index) => {
    const entryPath = `${levelsPath}[${index}]`;
    if (!isRecord(entry)) throw new ConfigLoadError(entryPath, '必须是 object');
    const expectedId = `L${String(index + 1).padStart(2, '0')}`;
    const id = stringField(entry, 'id', entryPath);
    if (id !== expectedId || !CHAPTER_INDEX_LEVEL_ID.test(id)) {
      throw new ConfigLoadError(`${entryPath}.id`, `必须按顺序为 ${expectedId}`);
    }
    if (ids.has(id)) throw new ConfigLoadError(`${entryPath}.id`, `重复 ID: ${id}`);
    ids.add(id);
    const resource = stringField(entry, 'resource', entryPath);
    const expectedResource = `config/levels/chapter01/${id}`;
    if (resource !== expectedResource) {
      throw new ConfigLoadError(`${entryPath}.resource`, `必须是 ${expectedResource}`);
    }
    const prerequisite = required(entry, 'prerequisiteLevelId', entryPath);
    const expectedPrerequisite = index === 0 ? null : `L${String(index).padStart(2, '0')}`;
    if (prerequisite !== expectedPrerequisite) {
      throw new ConfigLoadError(`${entryPath}.prerequisiteLevelId`, `必须是 ${expectedPrerequisite ?? 'null'}`);
    }
  });

  const targetIds = assertIndexStringArray(required(value, 'targetIds', configPath), `${configPath}.targetIds`);
  const rewardPath = `${configPath}.rewardRegistries`;
  const rewardRegistries = required(value, 'rewardRegistries', configPath);
  if (!isRecord(rewardRegistries)) throw new ConfigLoadError(rewardPath, '必须是 object');
  const unlockIds = assertIndexStringArray(required(rewardRegistries, 'unlockIds', rewardPath), `${rewardPath}.unlockIds`);
  const chestIds = assertIndexStringArray(required(rewardRegistries, 'chestIds', rewardPath), `${rewardPath}.chestIds`);
  const flagIds = assertIndexStringArray(required(rewardRegistries, 'flagIds', rewardPath), `${rewardPath}.flagIds`);
  return {
    schemaVersion: 1,
    id: 'CHAPTER01-LEVEL-INDEX',
    chapterId: 'CHAPTER01',
    levels: levels as ChapterLevelIndexEntry[],
    targetIds,
    rewardRegistries: { unlockIds, chestIds, flagIds },
  };
}

function tableRows(value: Record<string, unknown>, tableName: string, configPath: string): Record<string, unknown>[] {
  const rows = value[tableName];
  if (!Array.isArray(rows)) throw new ConfigLoadError(`${configPath}.${tableName}`, '必须是 array');
  return rows.filter((row): row is Record<string, unknown> => isRecord(row) && row.enabled !== false);
}

function buildChapterLevelReferences(
  index: ChapterLevelIndex,
  tables: ReadonlyMap<string, Record<string, unknown>>,
): ChapterLevelReferences {
  const units = tableRows(tables.get('units')!, 'units', 'config/units');
  const skills = tableRows(tables.get('skills')!, 'skills', 'config/skills');
  const cards = tableRows(tables.get('cards')!, 'cards', 'config/cards');
  const unitIds = new Set(units.map((row) => row.id as string));
  const skillIds = new Set(skills.map((row) => row.id as string));
  const cardReferences = new Map<string, {
    cardType: 'UNIT' | 'SKILL';
    copyLimit: number;
    unitId?: string;
    skillId?: string;
  }>();
  cards.forEach((card) => {
    cardReferences.set(card.id as string, {
      cardType: card.cardType as 'UNIT' | 'SKILL',
      copyLimit: card.copyLimit as number,
      ...(typeof card.unitId === 'string' ? { unitId: card.unitId } : {}),
      ...(typeof card.skillId === 'string' ? { skillId: card.skillId } : {}),
    });
  });
  return {
    chapterLevelIds: new Set(index.levels.map((entry) => entry.id)),
    targetIds: new Set([...unitIds, ...index.targetIds]),
    unitIds,
    skillIds,
    cards: cardReferences,
    unlockIds: new Set(index.rewardRegistries.unlockIds),
    chestIds: new Set(index.rewardRegistries.chestIds),
    flagIds: new Set(index.rewardRegistries.flagIds),
  };
}

export async function loadChapter01Levels(
  manifest: ConfigManifest,
  tables: ReadonlyMap<string, Record<string, unknown>>,
): Promise<ChapterLevelConfig[]> {
  const index = assertChapterLevelIndex(await loadJsonAsset(manifest.chapters.chapter01));
  const references = buildChapterLevelReferences(index, tables);
  const decks = tables.get('decks');
  if (!decks) throw new ConfigLoadError('config/decks', '牌组资源未加载');
  const chapterContract = await import('./levels/ChapterLevelContract');
  return Promise.all(index.levels.map(async (entry) => {
    const value = await loadJsonAsset(entry.resource);
    if (!isRecord(value) || !Array.isArray(value.chapterLevels) || value.chapterLevels.length !== 1) {
      throw new ConfigLoadError(entry.resource, '必须包含恰好一个 chapterLevels 条目');
    }
    const levelValue = value.chapterLevels[0];
    if (!isRecord(levelValue) || levelValue.id !== entry.id) {
      throw new ConfigLoadError(`${entry.resource}.chapterLevels[0].id`, `必须与索引一致: ${entry.id}`);
    }
    if (levelValue.prerequisiteLevelId !== entry.prerequisiteLevelId) {
      throw new ConfigLoadError(
        `${entry.resource}.chapterLevels[0].prerequisiteLevelId`,
        `必须与章节索引一致: ${entry.prerequisiteLevelId ?? 'null'}`,
      );
    }
    chapterContract.assertChapterLevelContract(value, manifest, decks, references, entry.resource);
    return value.chapterLevels[0] as ChapterLevelConfig;
  }));
}

export function loadConfigManifest(): Promise<ConfigManifest> {
  return new Promise((resolve, reject) => {
    resources.load('config/manifest', JsonAsset, (error, asset) => {
      if (error) {
        reject(new ConfigLoadError('config/manifest', error.message || '资源读取失败', { cause: error }));
        return;
      }
      try {
        assertConfigManifest(asset?.json);
        const manifest = asset.json;
        const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks'] as const;
        const tableLoads = tableNames.map((tableName) =>
          loadJsonAsset(manifest.tables[tableName]).then((table) => assertTable(table, tableName, manifest.tables[tableName]))
        );
        void Promise.all(tableLoads).then(async (tableValues) => {
          const tables = new Map(tableNames.map((tableName, index) => [tableName, tableValues[index]]));
          await loadChapter01Levels(manifest, tables);
          resolve(manifest);
        }).catch(reject);
      } catch (validationError) {
        reject(validationError);
      }
    });
  });
}
