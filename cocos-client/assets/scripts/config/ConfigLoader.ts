import { JsonAsset, resources } from 'cc';

export type EvidenceLevel = 'A' | 'B' | 'C';

export interface ConfigManifest {
  schemaVersion: 1;
  id: string;
  evidenceLevel: EvidenceLevel;
  version: number;
  enabled: boolean;
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
        resolve(asset.json);
      } catch (validationError) {
        reject(validationError);
      }
    });
  });
}
