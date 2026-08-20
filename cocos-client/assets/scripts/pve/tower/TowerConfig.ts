export type TowerEnvironment = 'NONE' | 'METAL' | 'WOOD' | 'WATER' | 'FIRE' | 'EARTH';
export type TowerDifficulty = 'STANDARD' | 'HARD' | 'ELITE' | 'NIGHTMARE' | 'BOSS';
export type TowerSpecialRule =
  | 'NONE'
  | 'PRESSURE_LANES'
  | 'ELEMENTAL_SURGE'
  | 'REINFORCED_FRONT'
  | 'SKILL_LOCK'
  | 'ESCALATING_THREAT'
  | 'NO_SAFE_LANE'
  | 'REVIVAL_WINDOW'
  | 'BOSS_AURA'
  | 'ASCENSION_TEST';

export interface TowerEnemyPool {
  readonly id: string;
  readonly tier: number;
  readonly unitIds: readonly string[];
}

export interface TowerStage {
  readonly id: string;
  readonly floorStart: number;
  readonly floorEnd: number;
  readonly difficulty: TowerDifficulty;
  readonly enemyPoolId: string;
  readonly environmentElement: TowerEnvironment;
  readonly specialRule: TowerSpecialRule;
}

export interface TowerFloorRules {
  readonly threatMultiplierPercent: number;
  readonly maxEnemyUnits: number;
  readonly enemyActionInterval: number;
  readonly maxRounds: number;
  readonly randomness: number;
  readonly environmentElement: TowerEnvironment;
  readonly specialRule: TowerSpecialRule;
}

export interface TowerFloor {
  readonly floor: number;
  readonly stageId: string;
  readonly enemyPoolId: string;
  readonly enemyIds: readonly string[];
  readonly rules: TowerFloorRules;
}

export interface TowerConfig {
  readonly schemaVersion: 1;
  readonly table: 'tower';
  readonly evidenceLevel: 'C';
  readonly version: number;
  readonly enabled: true;
  readonly id: 'TOWER_50_FLOORS';
  readonly floorCount: 50;
  readonly stageSize: 5;
  readonly enemyUnitIds: readonly string[];
  readonly enemyPools: readonly TowerEnemyPool[];
  readonly stages: readonly TowerStage[];
  readonly floors: readonly TowerFloor[];
}

export const TOWER_FLOOR_COUNT = 50;
export const TOWER_STAGE_SIZE = 5;
export const TOWER_STAGE_COUNT = TOWER_FLOOR_COUNT / TOWER_STAGE_SIZE;
export const TOWER_ENEMY_UNIT_IDS = Object.freeze(
  Array.from({ length: 28 }, (_unused, index) => `U${String(index + 1).padStart(3, '0')}`),
);

const ENVIRONMENTS: readonly TowerEnvironment[] = ['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH'];
const DIFFICULTIES: readonly TowerDifficulty[] = ['STANDARD', 'HARD', 'ELITE', 'NIGHTMARE', 'BOSS'];
const SPECIAL_RULES: readonly TowerSpecialRule[] = [
  'NONE',
  'PRESSURE_LANES',
  'ELEMENTAL_SURGE',
  'REINFORCED_FRONT',
  'SKILL_LOCK',
  'ESCALATING_THREAT',
  'NO_SAFE_LANE',
  'REVIVAL_WINDOW',
  'BOSS_AURA',
  'ASCENSION_TEST',
];

const STAGE_BLUEPRINTS: ReadonlyArray<{
  readonly difficulty: TowerDifficulty;
  readonly environmentElement: TowerEnvironment;
  readonly specialRule: TowerSpecialRule;
}> = [
  { difficulty: 'STANDARD', environmentElement: 'NONE', specialRule: 'NONE' },
  { difficulty: 'STANDARD', environmentElement: 'METAL', specialRule: 'PRESSURE_LANES' },
  { difficulty: 'HARD', environmentElement: 'WOOD', specialRule: 'ELEMENTAL_SURGE' },
  { difficulty: 'HARD', environmentElement: 'EARTH', specialRule: 'REINFORCED_FRONT' },
  { difficulty: 'ELITE', environmentElement: 'WATER', specialRule: 'SKILL_LOCK' },
  { difficulty: 'ELITE', environmentElement: 'FIRE', specialRule: 'ESCALATING_THREAT' },
  { difficulty: 'NIGHTMARE', environmentElement: 'METAL', specialRule: 'NO_SAFE_LANE' },
  { difficulty: 'NIGHTMARE', environmentElement: 'WATER', specialRule: 'REVIVAL_WINDOW' },
  { difficulty: 'BOSS', environmentElement: 'EARTH', specialRule: 'BOSS_AURA' },
  { difficulty: 'BOSS', environmentElement: 'FIRE', specialRule: 'ASCENSION_TEST' },
];

const ENEMY_POOL_BLUEPRINTS: ReadonlyArray<readonly string[]> = [
  ['U001', 'U002', 'U003', 'U004', 'U005', 'U006'],
  ['U005', 'U006', 'U007', 'U008', 'U009', 'U010'],
  ['U009', 'U010', 'U011', 'U012', 'U013', 'U014'],
  ['U013', 'U014', 'U015', 'U016', 'U017', 'U018'],
  ['U017', 'U018', 'U019', 'U020', 'U021', 'U022'],
  ['U021', 'U022', 'U023', 'U024', 'U025', 'U026'],
  ['U023', 'U024', 'U025', 'U026', 'U027', 'U028'],
  ['U004', 'U010', 'U012', 'U018', 'U024', 'U027'],
  ['U007', 'U011', 'U015', 'U019', 'U020', 'U028'],
  ['U008', 'U019', 'U020', 'U023', 'U026', 'U028'],
];

export class TowerConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`塔配置无效 [${configPath}]: ${message}`);
    this.name = 'TowerConfigError';
    this.configPath = configPath;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], configPath: string): void {
  const allowed = new Set(keys);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new TowerConfigError(`${configPath}.${key}`, '缺少必需字段');
    }
  }
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TowerConfigError(`${configPath}.${String(key)}`, '不允许未知字段');
    }
  }
  for (let prototype = Object.getPrototypeOf(record); prototype !== null && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const key of Reflect.ownKeys(prototype)) {
      if (typeof key !== 'string' || !allowed.has(key)) {
        throw new TowerConfigError(`${configPath}.${String(key)}`, '原型上不允许未知字段');
      }
    }
  }
}

function stringField(record: Record<string, unknown>, key: string, configPath: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TowerConfigError(`${configPath}.${key}`, '必须是非空 string');
  }
  return value;
}

function integerField(record: Record<string, unknown>, key: string, min: number, max: number, configPath: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new TowerConfigError(`${configPath}.${key}`, `必须是 ${min} 到 ${max} 的整数`);
  }
  return value as number;
}

function booleanField(record: Record<string, unknown>, key: string, expected: boolean, configPath: string): boolean {
  if (record[key] !== expected) {
    throw new TowerConfigError(`${configPath}.${key}`, `必须是 ${String(expected)}`);
  }
  return expected;
}

function enumField<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  configPath: string,
): T {
  const value = record[key];
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TowerConfigError(`${configPath}.${key}`, `必须是 ${values.join('、')} 之一`);
  }
  return value as T;
}

function uniqueStringArray(
  record: Record<string, unknown>,
  key: string,
  configPath: string,
  minLength: number,
  maxLength: number,
): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    throw new TowerConfigError(`${configPath}.${key}`, `必须是 ${minLength} 到 ${maxLength} 项的 string 数组`);
  }
  if (value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TowerConfigError(`${configPath}.${key}`, '必须只包含非空 string');
  }
  const items = value as string[];
  if (new Set(items).size !== items.length) {
    throw new TowerConfigError(`${configPath}.${key}`, '不得包含重复 ID');
  }
  return items;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function sameStringArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function buildFloorEnemyIds(floorIndex: number, unitIds: readonly string[]): string[] {
  const maxEnemyUnits = Math.min(6, 2 + Math.floor(floorIndex / 10));
  const count = Math.min(maxEnemyUnits, unitIds.length);
  const offset = floorIndex % unitIds.length;
  return Array.from({ length: count }, (_item, index) => unitIds[(offset + index) % unitIds.length]);
}

function buildEnemyPools(): TowerEnemyPool[] {
  return ENEMY_POOL_BLUEPRINTS.map((unitIds, index) => ({
    id: `POOL_${String(index + 1).padStart(2, '0')}`,
    tier: index + 1,
    unitIds: [...unitIds],
  }));
}

function buildStages(): TowerStage[] {
  return STAGE_BLUEPRINTS.map((blueprint, index) => ({
    id: `STAGE_${String(index + 1).padStart(2, '0')}`,
    floorStart: index * TOWER_STAGE_SIZE + 1,
    floorEnd: (index + 1) * TOWER_STAGE_SIZE,
    enemyPoolId: `POOL_${String(index + 1).padStart(2, '0')}`,
    ...blueprint,
  }));
}

function buildFloors(stages: readonly TowerStage[], pools: readonly TowerEnemyPool[]): TowerFloor[] {
  const poolsById = new Map(pools.map((pool) => [pool.id, pool]));
  return Array.from({ length: TOWER_FLOOR_COUNT }, (_unused, floorIndex) => {
    const floor = floorIndex + 1;
    const stageIndex = Math.floor(floorIndex / TOWER_STAGE_SIZE);
    const stage = stages[stageIndex];
    const pool = poolsById.get(stage.enemyPoolId)!;
    const maxEnemyUnits = Math.min(6, 2 + Math.floor(floorIndex / 10));
    const enemyActionInterval = Math.max(1, 5 - Math.floor(floorIndex / 10));
    const enemyIds = buildFloorEnemyIds(floorIndex, pool.unitIds);
    return {
      floor,
      stageId: stage.id,
      enemyPoolId: pool.id,
      enemyIds,
      rules: {
        threatMultiplierPercent: 100 + floorIndex * 5,
        maxEnemyUnits,
        enemyActionInterval,
        maxRounds: 48 - Math.floor(floorIndex / TOWER_STAGE_SIZE) * 3,
        randomness: 500 - floorIndex * 7,
        environmentElement: stage.environmentElement,
        specialRule: stage.specialRule,
      },
    };
  });
}

export function createTowerConfig(): TowerConfig {
  const enemyPools = buildEnemyPools();
  const stages = buildStages();
  return deepFreeze({
    schemaVersion: 1,
    table: 'tower',
    evidenceLevel: 'C',
    version: 1,
    enabled: true,
    id: 'TOWER_50_FLOORS',
    floorCount: TOWER_FLOOR_COUNT,
    stageSize: TOWER_STAGE_SIZE,
    enemyUnitIds: [...TOWER_ENEMY_UNIT_IDS],
    enemyPools,
    stages,
    floors: buildFloors(stages, enemyPools),
  });
}

export function loadTowerConfig(
  value: unknown,
  knownEnemyUnitIds: ReadonlySet<string> = new Set(TOWER_ENEMY_UNIT_IDS),
): TowerConfig {
  if (!isRecord(value)) throw new TowerConfigError('config', '根值必须是 object');
  exactKeys(value, [
    'schemaVersion', 'table', 'evidenceLevel', 'version', 'enabled', 'id', 'floorCount', 'stageSize',
    'enemyUnitIds', 'enemyPools', 'stages', 'floors',
  ], 'config');
  if (value.schemaVersion !== 1) throw new TowerConfigError('config.schemaVersion', '必须是 1');
  if (value.table !== 'tower') throw new TowerConfigError('config.table', '必须是 tower');
  if (value.evidenceLevel !== 'C') throw new TowerConfigError('config.evidenceLevel', '必须是 C');
  integerField(value, 'version', 1, 999, 'config');
  booleanField(value, 'enabled', true, 'config');
  if (value.id !== 'TOWER_50_FLOORS') throw new TowerConfigError('config.id', '必须是 TOWER_50_FLOORS');
  if (value.floorCount !== TOWER_FLOOR_COUNT) throw new TowerConfigError('config.floorCount', '必须是 50');
  if (value.stageSize !== TOWER_STAGE_SIZE) throw new TowerConfigError('config.stageSize', '必须是 5');

  const enemyUnitIds = uniqueStringArray(value, 'enemyUnitIds', 'config', TOWER_ENEMY_UNIT_IDS.length, TOWER_ENEMY_UNIT_IDS.length);
  const configuredEnemyIds = new Set(enemyUnitIds);
  for (const unitId of enemyUnitIds) {
    if (!knownEnemyUnitIds.has(unitId)) throw new TowerConfigError(`config.enemyUnitIds[${unitId}]`, `未知敌方单位: ${unitId}`);
  }

  const poolValues = value.enemyPools;
  if (!Array.isArray(poolValues) || poolValues.length !== TOWER_STAGE_COUNT) {
    throw new TowerConfigError('config.enemyPools', '必须恰好包含 10 个敌方池');
  }
  const pools: TowerEnemyPool[] = [];
  const poolIds = new Set<string>();
  poolValues.forEach((poolValue, index) => {
    const configPath = `config.enemyPools[${index}]`;
    if (!isRecord(poolValue)) throw new TowerConfigError(configPath, '必须是 object');
    exactKeys(poolValue, ['id', 'tier', 'unitIds'], configPath);
    const id = stringField(poolValue, 'id', configPath);
    const tier = integerField(poolValue, 'tier', 1, TOWER_STAGE_COUNT, configPath);
    const unitIds = uniqueStringArray(poolValue, 'unitIds', configPath, 4, 8);
    if (poolIds.has(id)) throw new TowerConfigError(`${configPath}.id`, `重复敌方池 ID: ${id}`);
    poolIds.add(id);
    if (tier !== index + 1) throw new TowerConfigError(`${configPath}.tier`, '敌方池 tier 必须按 1 到 10 顺序');
    if (!sameStringArray(unitIds, ENEMY_POOL_BLUEPRINTS[index])) {
      throw new TowerConfigError(`${configPath}.unitIds`, '敌方池内容必须与对应 tier 的区间配置一致，且不得与其他池同质');
    }
    unitIds.forEach((unitId, unitIndex) => {
      if (!configuredEnemyIds.has(unitId)) throw new TowerConfigError(`${configPath}.unitIds[${unitIndex}]`, `未注册敌方单位: ${unitId}`);
      if (!knownEnemyUnitIds.has(unitId)) throw new TowerConfigError(`${configPath}.unitIds[${unitIndex}]`, `未知敌方单位: ${unitId}`);
    });
    pools.push({ id, tier, unitIds });
  });

  const stageValues = value.stages;
  if (!Array.isArray(stageValues) || stageValues.length !== TOWER_STAGE_COUNT) {
    throw new TowerConfigError('config.stages', '必须恰好包含 10 个难度阶段');
  }
  const stages: TowerStage[] = [];
  const stageIds = new Set<string>();
  let previousDifficultyRank = -1;
  let hasDifficultyProgression = false;
  let hasSpecialRuleProgression = false;
  stageValues.forEach((stageValue, index) => {
    const configPath = `config.stages[${index}]`;
    if (!isRecord(stageValue)) throw new TowerConfigError(configPath, '必须是 object');
    exactKeys(stageValue, ['id', 'floorStart', 'floorEnd', 'difficulty', 'enemyPoolId', 'environmentElement', 'specialRule'], configPath);
    const id = stringField(stageValue, 'id', configPath);
    const floorStart = integerField(stageValue, 'floorStart', 1, TOWER_FLOOR_COUNT, configPath);
    const floorEnd = integerField(stageValue, 'floorEnd', 1, TOWER_FLOOR_COUNT, configPath);
    const difficulty = enumField(stageValue, 'difficulty', DIFFICULTIES, configPath);
    const enemyPoolId = stringField(stageValue, 'enemyPoolId', configPath);
    const environmentElement = enumField(stageValue, 'environmentElement', ENVIRONMENTS, configPath);
    const specialRule = enumField(stageValue, 'specialRule', SPECIAL_RULES, configPath);
    if (stageIds.has(id)) throw new TowerConfigError(`${configPath}.id`, `重复阶段 ID: ${id}`);
    stageIds.add(id);
    if (id !== `STAGE_${String(index + 1).padStart(2, '0')}`) throw new TowerConfigError(`${configPath}.id`, '阶段 ID 必须按 STAGE_01 至 STAGE_10 顺序');
    if (floorStart !== index * TOWER_STAGE_SIZE + 1 || floorEnd !== (index + 1) * TOWER_STAGE_SIZE) {
      throw new TowerConfigError(configPath, '阶段必须覆盖连续的五层且不得重叠');
    }
    if (!poolIds.has(enemyPoolId)) throw new TowerConfigError(`${configPath}.enemyPoolId`, `未知敌方池: ${enemyPoolId}`);
    if (pools[index].tier !== index + 1 || enemyPoolId !== pools[index].id) {
      throw new TowerConfigError(`${configPath}.enemyPoolId`, '阶段敌方池必须按 POOL_01 至 POOL_10 顺序递进');
    }
    const expectedStage = STAGE_BLUEPRINTS[index];
    if (difficulty !== expectedStage.difficulty) {
      throw new TowerConfigError(`${configPath}.difficulty`, '阶段难度序列必须与当前塔配置一致并真实递进');
    }
    if (environmentElement !== expectedStage.environmentElement) {
      throw new TowerConfigError(`${configPath}.environmentElement`, '阶段环境序列必须与当前塔配置一致');
    }
    if (specialRule !== expectedStage.specialRule) {
      throw new TowerConfigError(`${configPath}.specialRule`, '阶段特殊规则序列必须与当前塔配置一致并真实递进');
    }
    const difficultyRank = DIFFICULTIES.indexOf(difficulty);
    if (difficultyRank < previousDifficultyRank) throw new TowerConfigError(`${configPath}.difficulty`, '难度不得随阶段下降');
    if (index > 0 && difficultyRank > previousDifficultyRank) hasDifficultyProgression = true;
    if (index > 0 && specialRule !== stages[index - 1].specialRule) hasSpecialRuleProgression = true;
    previousDifficultyRank = difficultyRank;
    stages.push({ id, floorStart, floorEnd, difficulty, enemyPoolId, environmentElement, specialRule });
  });
  if (!hasDifficultyProgression) throw new TowerConfigError('config.stages', '阶段难度必须包含真实递进');
  if (!hasSpecialRuleProgression) throw new TowerConfigError('config.stages', '阶段特殊规则必须包含真实递进');

  const floorValues = value.floors;
  if (!Array.isArray(floorValues) || floorValues.length !== TOWER_FLOOR_COUNT) {
    throw new TowerConfigError('config.floors', '必须恰好包含 50 层');
  }
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const floors: TowerFloor[] = [];
  let previousRules: TowerFloorRules | undefined;
  floorValues.forEach((floorValue, index) => {
    const configPath = `config.floors[${index}]`;
    if (!isRecord(floorValue)) throw new TowerConfigError(configPath, '必须是 object');
    exactKeys(floorValue, ['floor', 'stageId', 'enemyPoolId', 'enemyIds', 'rules'], configPath);
    const floor = integerField(floorValue, 'floor', 1, TOWER_FLOOR_COUNT, configPath);
    const stageId = stringField(floorValue, 'stageId', configPath);
    const enemyPoolId = stringField(floorValue, 'enemyPoolId', configPath);
    const enemyIds = uniqueStringArray(floorValue, 'enemyIds', configPath, 2, 6);
    if (floor !== index + 1) throw new TowerConfigError(`${configPath}.floor`, '楼层必须按 1 到 50 连续排列');
    const stage = stageById.get(stageId);
    if (!stage) throw new TowerConfigError(`${configPath}.stageId`, `未知阶段: ${stageId}`);
    if (floor < stage.floorStart || floor > stage.floorEnd) throw new TowerConfigError(`${configPath}.stageId`, '楼层与阶段范围不匹配');
    if (enemyPoolId !== stage.enemyPoolId) throw new TowerConfigError(`${configPath}.enemyPoolId`, '楼层敌方池必须与阶段一致');
    const pool = poolById.get(enemyPoolId)!;
    const expectedEnemyIds = buildFloorEnemyIds(index, ENEMY_POOL_BLUEPRINTS[Math.floor(index / TOWER_STAGE_SIZE)]);
    if (!sameStringArray(enemyIds, expectedEnemyIds)) {
      throw new TowerConfigError(`${configPath}.enemyIds`, '楼层敌人必须按阶段和楼层递进，不能使用固定组合');
    }
    enemyIds.forEach((unitId, enemyIndex) => {
      if (!pool.unitIds.includes(unitId)) throw new TowerConfigError(`${configPath}.enemyIds[${enemyIndex}]`, `敌人不属于配置池: ${unitId}`);
    });
    if (!isRecord(floorValue.rules)) throw new TowerConfigError(`${configPath}.rules`, '必须是 object');
    const rulesValue = floorValue.rules;
    const rulesPath = `${configPath}.rules`;
    exactKeys(rulesValue, [
      'threatMultiplierPercent', 'maxEnemyUnits', 'enemyActionInterval', 'maxRounds', 'randomness',
      'environmentElement', 'specialRule',
    ], rulesPath);
    const rules: TowerFloorRules = {
      threatMultiplierPercent: integerField(rulesValue, 'threatMultiplierPercent', 100, 500, rulesPath),
      maxEnemyUnits: integerField(rulesValue, 'maxEnemyUnits', 2, 6, rulesPath),
      enemyActionInterval: integerField(rulesValue, 'enemyActionInterval', 1, 5, rulesPath),
      maxRounds: integerField(rulesValue, 'maxRounds', 12, 60, rulesPath),
      randomness: integerField(rulesValue, 'randomness', 0, 500, rulesPath),
      environmentElement: enumField(rulesValue, 'environmentElement', ENVIRONMENTS, rulesPath),
      specialRule: enumField(rulesValue, 'specialRule', SPECIAL_RULES, rulesPath),
    };
    if (rules.environmentElement !== stage.environmentElement || rules.specialRule !== stage.specialRule) {
      throw new TowerConfigError(rulesPath, '楼层规则必须与阶段规则一致');
    }
    if (enemyIds.length > rules.maxEnemyUnits) throw new TowerConfigError(`${configPath}.enemyIds`, '敌人数不得超过该层上限');
    if (previousRules) {
      if (rules.threatMultiplierPercent <= previousRules.threatMultiplierPercent) throw new TowerConfigError(`${rulesPath}.threatMultiplierPercent`, '威胁倍率必须逐层增加');
      if (rules.maxEnemyUnits < previousRules.maxEnemyUnits) throw new TowerConfigError(`${rulesPath}.maxEnemyUnits`, '敌人数上限不得逐层下降');
      if (rules.enemyActionInterval > previousRules.enemyActionInterval) throw new TowerConfigError(`${rulesPath}.enemyActionInterval`, '敌方行动间隔不得逐层变慢');
      if (rules.maxRounds > previousRules.maxRounds) throw new TowerConfigError(`${rulesPath}.maxRounds`, '回合上限不得逐层增加');
      if (rules.randomness > previousRules.randomness) throw new TowerConfigError(`${rulesPath}.randomness`, '随机性不得逐层增加');
    }
    previousRules = rules;
    floors.push({ floor, stageId, enemyPoolId, enemyIds, rules });
  });

  return value as TowerConfig;
}

export function isTowerConfig(value: unknown, knownEnemyUnitIds?: ReadonlySet<string>): value is TowerConfig {
  try {
    loadTowerConfig(value, knownEnemyUnitIds);
    return true;
  } catch {
    return false;
  }
}

export const towerConfig = createTowerConfig();
loadTowerConfig(towerConfig);
