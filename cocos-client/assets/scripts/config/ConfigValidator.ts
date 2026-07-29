import { ConfigLoadError } from './ConfigLoader';

export type UnitRole = 'frontline' | 'ranged' | 'support';
export type EffectType = 'damage' | 'heal' | 'buff';

export interface ConfigUnit {
  id: string;
  role: UnitRole;
  maxHp: number;
  effects: string[];
}

export interface ConfigEffect {
  id: string;
  type: EffectType;
  value: number;
  nextEffectId: string | null;
}

export interface ConfigTables {
  units: ConfigUnit[];
  effects: ConfigEffect[];
}

const UNIT_ROLES: readonly UnitRole[] = ['frontline', 'ranged', 'support'];
const EFFECT_TYPES: readonly EffectType[] = ['damage', 'heal', 'buff'];
const MAX_CONFIG_VALUE = 9999;

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configRequired(record: Record<string, unknown>, key: string, configPath: string): unknown {
  if (!(key in record)) throw new ConfigLoadError(`${configPath}.${key}`, '缺少必需字段');
  return record[key];
}

function idField(record: Record<string, unknown>, configPath: string): string {
  const id = configRequired(record, 'id', configPath);
  if (typeof id !== 'string' || id.length === 0) {
    throw new ConfigLoadError(`${configPath}.id`, '必须是非空 string');
  }
  return id;
}

function enumField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  configPath: string,
): T {
  const value = configRequired(record, key, configPath);
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ConfigLoadError(`${configPath}.${key}`, `必须是 ${values.join('、')} 之一`);
  }
  return value as T;
}

function boundedInteger(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  configPath: string,
): number {
  const value = configRequired(record, key, configPath);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigLoadError(`${configPath}.${key}`, `必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

function stringArray(record: Record<string, unknown>, key: string, configPath: string): string[] {
  const value = configRequired(record, key, configPath);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new ConfigLoadError(`${configPath}.${key}`, '必须是非空 string 数组');
  }
  return value as string[];
}

function table<T>(value: unknown, tableName: string, parser: (item: unknown, index: number) => T): T[] {
  const configPath = `config/tables.${tableName}`;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigLoadError(configPath, '必须是非空 array');
  }
  const ids = new Set<string>();
  return value.map((item, index) => {
    const itemPath = `${configPath}[${index}]`;
    const parsed = parser(item, index);
    const id = idField(parsed as unknown as Record<string, unknown>, itemPath);
    if (ids.has(id)) throw new ConfigLoadError(`${itemPath}.id`, `重复 ID: ${id}`);
    ids.add(id);
    return parsed;
  });
}

function parseUnit(item: unknown, index: number): ConfigUnit {
  const configPath = `config/tables.units[${index}]`;
  if (!isConfigRecord(item)) throw new ConfigLoadError(configPath, '必须是 object');
  return {
    id: idField(item, configPath),
    role: enumField(item, 'role', UNIT_ROLES, configPath),
    maxHp: boundedInteger(item, 'maxHp', 1, MAX_CONFIG_VALUE, configPath),
    effects: stringArray(item, 'effects', configPath),
  };
}

function parseEffect(item: unknown, index: number): ConfigEffect {
  const configPath = `config/tables.effects[${index}]`;
  if (!isConfigRecord(item)) throw new ConfigLoadError(configPath, '必须是 object');
  const nextEffectId = configRequired(item, 'nextEffectId', configPath);
  if (nextEffectId !== null && (typeof nextEffectId !== 'string' || nextEffectId.length === 0)) {
    throw new ConfigLoadError(`${configPath}.nextEffectId`, '必须是 string 或 null');
  }
  return {
    id: idField(item, configPath),
    type: enumField(item, 'type', EFFECT_TYPES, configPath),
    value: boundedInteger(item, 'value', 1, MAX_CONFIG_VALUE, configPath),
    nextEffectId: nextEffectId as string | null,
  };
}

function assertReferences(units: ConfigUnit[], effects: ConfigEffect[]): void {
  const effectIds = new Set(effects.map((effect) => effect.id));
  units.forEach((unit, unitIndex) => unit.effects.forEach((effectId, effectIndex) => {
    if (!effectIds.has(effectId)) {
      throw new ConfigLoadError(
        `config/tables.units[${unitIndex}].effects[${effectIndex}]`,
        `缺失引用: ${effectId}`,
      );
    }
  }));
  effects.forEach((effect, index) => {
    if (effect.nextEffectId !== null && !effectIds.has(effect.nextEffectId)) {
      throw new ConfigLoadError(`config/tables.effects[${index}].nextEffectId`, `缺失引用: ${effect.nextEffectId}`);
    }
  });
}

function assertAcyclic(effects: ConfigEffect[]): void {
  const byId = new Map(effects.map((effect) => [effect.id, effect]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new ConfigLoadError(`config/tables.effects.${id}`, '效果引用不能形成循环');
    if (visited.has(id)) return;
    visiting.add(id);
    const next = byId.get(id)?.nextEffectId;
    if (next !== null && next !== undefined) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  effects.forEach((effect) => visit(effect.id));
}

export function assertConfigTables(value: unknown): asserts value is ConfigTables {
  if (!isConfigRecord(value)) throw new ConfigLoadError('config/tables', '根值必须是 JSON object');
  const tables = configRequired(value, 'tables', 'config');
  if (!isConfigRecord(tables)) throw new ConfigLoadError('config.tables', '必须是 object');
  // The runtime manifest stores resource paths; the loader validates and loads those
  // tables. Keep the legacy fixture shape below for the cross-table contract tests.
  if (typeof tables.units === 'string') {
    for (const tableName of ['units', 'cards', 'skills', 'effects', 'statuses']) {
      const tablePath = configRequired(tables, tableName, 'config.tables');
      if (tablePath !== `config/${tableName}`) {
        throw new ConfigLoadError(`config.tables.${tableName}`, `只允许加载 config/${tableName}`);
      }
    }
    return;
  }
  const units = table(tables.units, 'units', parseUnit);
  const effects = table(tables.effects, 'effects', parseEffect);
  assertReferences(units, effects);
  assertAcyclic(effects);
}

export function isConfigTables(value: unknown): value is ConfigTables {
  try {
    assertConfigTables(value);
    return true;
  } catch {
    return false;
  }
}
