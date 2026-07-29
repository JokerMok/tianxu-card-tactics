import { JsonAsset, resources } from 'cc';

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
  };
  idPolicy: {
    scope: string;
    format: string;
    stable: boolean;
    unique: boolean;
  };
  evidenceLevels: EvidenceLevel[];
}

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

function assertTable(value: unknown, tableName: string, configPath: string): void {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  if (value.table !== tableName) throw new ConfigLoadError(`${configPath}.table`, `必须是 ${tableName}`);
  const rows = value[tableName];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ConfigLoadError(`${configPath}.${tableName}`, '必须是非空 array');
  }
  rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id.length === 0) {
      throw new ConfigLoadError(`${configPath}.${tableName}[${index}].id`, '必须是非空 string');
    }
  });
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
  const expectedTables = ['units', 'cards', 'skills', 'effects', 'statuses'] as const;
  for (const tableName of expectedTables) {
    const tablePath = stringField(tables, tableName, tablesPath);
    if (tablePath !== `config/${tableName}`) {
      throw new ConfigLoadError(`${tablesPath}.${tableName}`, `只允许加载 config/${tableName}`);
    }
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
        const tableLoads = (['units', 'cards', 'skills', 'effects', 'statuses'] as const).map((tableName) =>
          loadJsonAsset(manifest.tables[tableName]).then((table) => assertTable(table, tableName, manifest.tables[tableName]))
        );
        void Promise.all(tableLoads).then(() => resolve(manifest), reject);
      } catch (validationError) {
        reject(validationError);
      }
    });
  });
}
