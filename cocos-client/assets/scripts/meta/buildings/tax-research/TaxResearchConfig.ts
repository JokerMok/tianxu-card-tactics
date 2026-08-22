import type { BuildingConfig } from '../BuildingConfig.ts';
import { findBuilding } from '../BuildingConfig.ts';

export type ResearchEffectId =
  | 'ALCHEMY_SUCCESS_RATE_BPS'
  | 'FORGE_SUCCESS_RATE_BPS'
  | 'BUILDING_SPEED_BPS';

export interface TaxPayoutDefinition {
  readonly resourceId: string;
  readonly dailyAmount: number;
  readonly dailyCap: number;
}

export interface TaxTierDefinition {
  readonly castleLevel: number;
  readonly payouts: readonly TaxPayoutDefinition[];
}

export interface TaxDefinition {
  readonly buildingId: string;
  readonly intervalDays: 1;
  readonly tiers: readonly TaxTierDefinition[];
}

export interface BuildingResearchPrerequisite {
  readonly type: 'building';
  readonly buildingId: string;
  readonly requiredLevel: number;
}

export interface ResearchResearchPrerequisite {
  readonly type: 'research';
  readonly researchId: string;
  readonly requiredLevel: number;
}

export type ResearchPrerequisite = BuildingResearchPrerequisite | ResearchResearchPrerequisite;

export interface ResearchEffectDefinition {
  readonly effectId: ResearchEffectId;
  readonly amountBps: number;
}

export interface ResearchUpgradeDefinition {
  readonly targetLevel: number;
  readonly cost: Readonly<Record<string, number>>;
  readonly durationMs: number;
  readonly prerequisites: readonly ResearchPrerequisite[];
  readonly effects: readonly ResearchEffectDefinition[];
}

export interface ResearchDefinition {
  readonly id: string;
  readonly initialLevel: 0;
  readonly maxLevel: number;
  readonly upgrades: readonly ResearchUpgradeDefinition[];
}

export interface TaxResearchConfig {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly buildingConfigId: string;
  readonly researchQueue: { readonly maxEntries: number };
  readonly tax: TaxDefinition;
  readonly researches: readonly ResearchDefinition[];
  readonly buildingConfig: BuildingConfig;
}

export class TaxResearchConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`税收研究配置无效 [${configPath}]: ${message}`);
    this.name = 'TaxResearchConfigError';
    this.configPath = configPath;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathKey(path: string, key: string): string {
  return `${path}.${key}`;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], configPath: string): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) throw new TaxResearchConfigError(pathKey(configPath, key), '不允许未知字段');
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TaxResearchConfigError(pathKey(configPath, key), '缺少必需字段');
    }
  }
}

function stringField(value: Record<string, unknown>, key: string, configPath: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0 || field !== field.trim()) {
    throw new TaxResearchConfigError(pathKey(configPath, key), '必须是非空且无首尾空白的 string');
  }
  return field;
}

function integerField(value: Record<string, unknown>, key: string, configPath: string, minimum: number): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < minimum) {
    throw new TaxResearchConfigError(pathKey(configPath, key), `必须是大于等于 ${minimum} 的安全整数`);
  }
  return field as number;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function copyConfig(value: TaxResearchConfig): TaxResearchConfig {
  return {
    schemaVersion: 1,
    id: value.id,
    buildingConfigId: value.buildingConfigId,
    researchQueue: { maxEntries: value.researchQueue.maxEntries },
    tax: {
      buildingId: value.tax.buildingId,
      intervalDays: 1,
      tiers: value.tax.tiers.map((tier) => ({
        castleLevel: tier.castleLevel,
        payouts: tier.payouts.map((payout) => ({ ...payout })),
      })),
    },
    researches: value.researches.map((research) => ({
      id: research.id,
      initialLevel: 0,
      maxLevel: research.maxLevel,
      upgrades: research.upgrades.map((upgrade) => ({
        targetLevel: upgrade.targetLevel,
        cost: { ...upgrade.cost },
        durationMs: upgrade.durationMs,
        prerequisites: upgrade.prerequisites.map((prerequisite) => ({ ...prerequisite })),
        effects: upgrade.effects.map((effect) => ({ ...effect })),
      })),
    })),
    buildingConfig: value.buildingConfig,
  };
}

function validateCost(
  cost: unknown,
  resourceIds: ReadonlySet<string>,
  configPath: string,
): asserts cost is Readonly<Record<string, number>> {
  if (!isRecord(cost) || Object.keys(cost).length === 0) {
    throw new TaxResearchConfigError(configPath, '必须是非空 object');
  }
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (!resourceIds.has(resourceId)) throw new TaxResearchConfigError(`${configPath}.${resourceId}`, '引用了不存在的建筑资源');
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new TaxResearchConfigError(`${configPath}.${resourceId}`, '必须是正安全整数');
    }
  }
}

function validatePrerequisite(
  value: unknown,
  configPath: string,
  buildingConfig: BuildingConfig,
  researchIds: ReadonlySet<string>,
  researchMaxLevels: ReadonlyMap<string, number>,
  currentResearchId: string,
): ResearchPrerequisite {
  if (!isRecord(value)) throw new TaxResearchConfigError(configPath, '必须是 object');
  const type = stringField(value, 'type', configPath);
  if (type === 'building') {
    exactKeys(value, ['type', 'buildingId', 'requiredLevel'], configPath);
    const buildingId = stringField(value, 'buildingId', configPath);
    const building = findBuilding(buildingConfig, buildingId);
    if (!building) throw new TaxResearchConfigError(pathKey(configPath, 'buildingId'), '引用了不存在的建筑');
    const requiredLevel = integerField(value, 'requiredLevel', configPath, 1);
    if (requiredLevel > building.maxLevel) {
      throw new TaxResearchConfigError(pathKey(configPath, 'requiredLevel'), '不能超过被引用建筑的 maxLevel');
    }
    return { type: 'building', buildingId, requiredLevel };
  }
  if (type === 'research') {
    exactKeys(value, ['type', 'researchId', 'requiredLevel'], configPath);
    const researchId = stringField(value, 'researchId', configPath);
    if (!researchIds.has(researchId)) throw new TaxResearchConfigError(pathKey(configPath, 'researchId'), '引用了不存在的研究');
    if (researchId === currentResearchId) {
      throw new TaxResearchConfigError(pathKey(configPath, 'researchId'), '研究不能以前置方式引用自身');
    }
    const requiredLevel = integerField(value, 'requiredLevel', configPath, 1);
    const referencedMaxLevel = researchMaxLevels.get(researchId);
    if (referencedMaxLevel !== undefined && requiredLevel > referencedMaxLevel) {
      throw new TaxResearchConfigError(pathKey(configPath, 'requiredLevel'), '不能超过被引用研究的 maxLevel');
    }
    return { type: 'research', researchId, requiredLevel };
  }
  throw new TaxResearchConfigError(pathKey(configPath, 'type'), '必须是 building 或 research');
}

function assertResearchDependenciesAcyclic(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  configPath: string,
): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const visit = (researchId: string): void => {
    if (visiting.has(researchId)) {
      const cycleStart = path.indexOf(researchId);
      const cycle = [...path.slice(cycleStart), researchId].join(' -> ');
      throw new TaxResearchConfigError(configPath, `研究前置不能形成环: ${cycle}`);
    }
    if (visited.has(researchId)) return;
    visiting.add(researchId);
    path.push(researchId);
    for (const dependency of dependencies.get(researchId) ?? []) visit(dependency);
    path.pop();
    visiting.delete(researchId);
    visited.add(researchId);
  };

  for (const researchId of dependencies.keys()) visit(researchId);
}

export function assertTaxResearchConfig(
  value: unknown,
  buildingConfig: BuildingConfig,
  configPath = 'meta/buildings/tax-research/tax-research-config',
): asserts value is Omit<TaxResearchConfig, 'buildingConfig'> {
  if (!isRecord(value)) throw new TaxResearchConfigError(configPath, '根值必须是 object');
  exactKeys(value, ['schemaVersion', 'id', 'buildingConfigId', 'researchQueue', 'tax', 'researches'], configPath);
  if (value.schemaVersion !== 1) throw new TaxResearchConfigError(pathKey(configPath, 'schemaVersion'), '必须是 1');
  stringField(value, 'id', configPath);
  if (stringField(value, 'buildingConfigId', configPath) !== buildingConfig.id) {
    throw new TaxResearchConfigError(pathKey(configPath, 'buildingConfigId'), '必须匹配 T234 建筑配置 id');
  }

  const resourceIds = new Set(buildingConfig.resources.map((resource) => resource.id));
  const queuePath = pathKey(configPath, 'researchQueue');
  if (!isRecord(value.researchQueue)) throw new TaxResearchConfigError(queuePath, '必须是 object');
  exactKeys(value.researchQueue, ['maxEntries'], queuePath);
  integerField(value.researchQueue, 'maxEntries', queuePath, 1);

  const taxPath = pathKey(configPath, 'tax');
  if (!isRecord(value.tax)) throw new TaxResearchConfigError(taxPath, '必须是 object');
  exactKeys(value.tax, ['buildingId', 'intervalDays', 'tiers'], taxPath);
  const taxBuildingId = stringField(value.tax, 'buildingId', taxPath);
  const taxBuilding = findBuilding(buildingConfig, taxBuildingId);
  if (!taxBuilding) throw new TaxResearchConfigError(pathKey(taxPath, 'buildingId'), '引用了不存在的建筑');
  if (taxBuildingId !== 'castle') throw new TaxResearchConfigError(pathKey(taxPath, 'buildingId'), '每日税收必须绑定 castle');
  if (value.tax.intervalDays !== 1) throw new TaxResearchConfigError(pathKey(taxPath, 'intervalDays'), '目前只支持每日领取');
  const tiersPath = pathKey(taxPath, 'tiers');
  if (!Array.isArray(value.tax.tiers) || value.tax.tiers.length !== taxBuilding.maxLevel - taxBuilding.initialLevel + 1) {
    throw new TaxResearchConfigError(tiersPath, '必须覆盖主堡从 initialLevel 到 maxLevel 的全部等级');
  }
  const expectedTaxResourceIds = [...resourceIds];
  value.tax.tiers.forEach((rawTier, index) => {
    const tierPath = `${tiersPath}[${index}]`;
    if (!isRecord(rawTier)) throw new TaxResearchConfigError(tierPath, '必须是 object');
    exactKeys(rawTier, ['castleLevel', 'payouts'], tierPath);
    const castleLevel = integerField(rawTier, 'castleLevel', tierPath, taxBuilding.initialLevel);
    if (castleLevel !== taxBuilding.initialLevel + index || castleLevel > taxBuilding.maxLevel) {
      throw new TaxResearchConfigError(pathKey(tierPath, 'castleLevel'), `必须按顺序为 ${taxBuilding.initialLevel + index}`);
    }
    const payoutsPath = pathKey(tierPath, 'payouts');
    if (!Array.isArray(rawTier.payouts) || rawTier.payouts.length !== expectedTaxResourceIds.length) {
      throw new TaxResearchConfigError(payoutsPath, '必须为每种建筑资源提供一条税收');
    }
    const payoutIds = new Set<string>();
    rawTier.payouts.forEach((rawPayout, payoutIndex) => {
      const payoutPath = `${payoutsPath}[${payoutIndex}]`;
      if (!isRecord(rawPayout)) throw new TaxResearchConfigError(payoutPath, '必须是 object');
      exactKeys(rawPayout, ['resourceId', 'dailyAmount', 'dailyCap'], payoutPath);
      const resourceId = stringField(rawPayout, 'resourceId', payoutPath);
      if (!resourceIds.has(resourceId)) throw new TaxResearchConfigError(pathKey(payoutPath, 'resourceId'), '引用了不存在的建筑资源');
      if (payoutIds.has(resourceId)) throw new TaxResearchConfigError(pathKey(payoutPath, 'resourceId'), '税收资源不能重复');
      payoutIds.add(resourceId);
      const dailyAmount = integerField(rawPayout, 'dailyAmount', payoutPath, 0);
      const dailyCap = integerField(rawPayout, 'dailyCap', payoutPath, 0);
      if (dailyAmount > dailyCap) throw new TaxResearchConfigError(pathKey(payoutPath, 'dailyAmount'), '不能超过 dailyCap');
    });
    if (payoutIds.size !== resourceIds.size) throw new TaxResearchConfigError(payoutsPath, '必须覆盖全部建筑资源');
  });

  const researchesPath = pathKey(configPath, 'researches');
  if (!Array.isArray(value.researches) || value.researches.length === 0) {
    throw new TaxResearchConfigError(researchesPath, '必须是非空 array');
  }
  const researchIds = new Set<string>();
  const researchMaxLevels = new Map<string, number>();
  value.researches.forEach((rawResearch, index) => {
    const researchPath = `${researchesPath}[${index}]`;
    if (!isRecord(rawResearch)) throw new TaxResearchConfigError(researchPath, '必须是 object');
    const id = rawResearch.id;
    if (typeof id === 'string' && id.length > 0 && id === id.trim()) {
      if (researchIds.has(id)) throw new TaxResearchConfigError(pathKey(researchPath, 'id'), `重复研究 ID: ${id}`);
      researchIds.add(id);
      if (Number.isSafeInteger(rawResearch.maxLevel) && (rawResearch.maxLevel as number) >= 1) {
        researchMaxLevels.set(id, rawResearch.maxLevel as number);
      }
    }
  });
  const effectIds = new Set<ResearchEffectId>(['ALCHEMY_SUCCESS_RATE_BPS', 'FORGE_SUCCESS_RATE_BPS', 'BUILDING_SPEED_BPS']);
  const researchDependencies = new Map<string, Set<string>>([...researchIds].map((researchId) => [researchId, new Set<string>()]));
  value.researches.forEach((rawResearch, index) => {
    const researchPath = `${researchesPath}[${index}]`;
    if (!isRecord(rawResearch)) throw new TaxResearchConfigError(researchPath, '必须是 object');
    exactKeys(rawResearch, ['id', 'initialLevel', 'maxLevel', 'upgrades'], researchPath);
    const id = stringField(rawResearch, 'id', researchPath);
    if (rawResearch.initialLevel !== 0) throw new TaxResearchConfigError(pathKey(researchPath, 'initialLevel'), '必须是 0');
    const maxLevel = integerField(rawResearch, 'maxLevel', researchPath, 1);
    const upgradesPath = pathKey(researchPath, 'upgrades');
    if (!Array.isArray(rawResearch.upgrades) || rawResearch.upgrades.length !== maxLevel) {
      throw new TaxResearchConfigError(upgradesPath, '必须完整提供从 1 到 maxLevel 的研究表');
    }
    rawResearch.upgrades.forEach((rawUpgrade, upgradeIndex) => {
      const upgradePath = `${upgradesPath}[${upgradeIndex}]`;
      if (!isRecord(rawUpgrade)) throw new TaxResearchConfigError(upgradePath, '必须是 object');
      exactKeys(rawUpgrade, ['targetLevel', 'cost', 'durationMs', 'prerequisites', 'effects'], upgradePath);
      const targetLevel = integerField(rawUpgrade, 'targetLevel', upgradePath, 1);
      if (targetLevel !== upgradeIndex + 1) throw new TaxResearchConfigError(pathKey(upgradePath, 'targetLevel'), `必须按顺序为 ${upgradeIndex + 1}`);
      validateCost(rawUpgrade.cost, resourceIds, pathKey(upgradePath, 'cost'));
      integerField(rawUpgrade, 'durationMs', upgradePath, 1);
      const prerequisitesPath = pathKey(upgradePath, 'prerequisites');
      if (!Array.isArray(rawUpgrade.prerequisites)) throw new TaxResearchConfigError(prerequisitesPath, '必须是 array');
      const prerequisiteKeys = new Set<string>();
      rawUpgrade.prerequisites.forEach((rawPrerequisite, prerequisiteIndex) => {
        const prerequisitePath = `${prerequisitesPath}[${prerequisiteIndex}]`;
        const prerequisite = validatePrerequisite(rawPrerequisite, prerequisitePath, buildingConfig, researchIds, researchMaxLevels, id);
        const key = prerequisite.type === 'building'
          ? `building:${prerequisite.buildingId}:${prerequisite.requiredLevel}`
          : `research:${prerequisite.researchId}:${prerequisite.requiredLevel}`;
        if (prerequisiteKeys.has(key)) throw new TaxResearchConfigError(prerequisitePath, '前置不能重复');
        prerequisiteKeys.add(key);
        if (prerequisite.type === 'research') researchDependencies.get(id)?.add(prerequisite.researchId);
      });
      const effectsPath = pathKey(upgradePath, 'effects');
      if (!Array.isArray(rawUpgrade.effects) || rawUpgrade.effects.length === 0) {
        throw new TaxResearchConfigError(effectsPath, '必须是非空 array');
      }
      const upgradeEffectIds = new Set<string>();
      rawUpgrade.effects.forEach((rawEffect, effectIndex) => {
        const effectPath = `${effectsPath}[${effectIndex}]`;
        if (!isRecord(rawEffect)) throw new TaxResearchConfigError(effectPath, '必须是 object');
        exactKeys(rawEffect, ['effectId', 'amountBps'], effectPath);
        const effectId = stringField(rawEffect, 'effectId', effectPath);
        if (!effectIds.has(effectId as ResearchEffectId)) throw new TaxResearchConfigError(pathKey(effectPath, 'effectId'), '研究效果 ID 未注册');
        if (upgradeEffectIds.has(effectId)) throw new TaxResearchConfigError(pathKey(effectPath, 'effectId'), '同一等级不能重复提供研究效果');
        upgradeEffectIds.add(effectId);
        const amountBps = integerField(rawEffect, 'amountBps', effectPath, 1);
        if (amountBps > 10000) throw new TaxResearchConfigError(pathKey(effectPath, 'amountBps'), '不能超过 10000');
      });
    });
  });
  assertResearchDependenciesAcyclic(researchDependencies, researchesPath);
}

export function loadTaxResearchConfig(value: unknown, buildingConfig: BuildingConfig, configPath = 'meta/buildings/tax-research/tax-research-config'): TaxResearchConfig {
  assertTaxResearchConfig(value, buildingConfig, configPath);
  return deepFreeze(copyConfig({ ...(value as Omit<TaxResearchConfig, 'buildingConfig'>), buildingConfig }));
}

export function findTaxTier(config: TaxResearchConfig, castleLevel: number): TaxTierDefinition | undefined {
  return config.tax.tiers.find((tier) => tier.castleLevel === castleLevel);
}

export function findResearch(config: TaxResearchConfig, researchId: string): ResearchDefinition | undefined {
  return config.researches.find((research) => research.id === researchId);
}

export function findResearchUpgrade(config: TaxResearchConfig, researchId: string, targetLevel: number): ResearchUpgradeDefinition | undefined {
  return findResearch(config, researchId)?.upgrades.find((upgrade) => upgrade.targetLevel === targetLevel);
}
