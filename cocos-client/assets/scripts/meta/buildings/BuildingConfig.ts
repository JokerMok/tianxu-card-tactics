export interface BuildingResourceDefinition {
  readonly id: string;
}

export interface BuildingPrerequisite {
  readonly buildingId: string;
  readonly requiredLevel: number;
}

export interface BuildingUpgradeDefinition {
  readonly targetLevel: number;
  readonly cost: Readonly<Record<string, number>>;
  readonly durationMs: number;
  readonly prerequisites: readonly BuildingPrerequisite[];
}

export interface BuildingDefinition {
  readonly id: string;
  readonly initialLevel: number;
  readonly maxLevel: number;
  readonly upgrades: readonly BuildingUpgradeDefinition[];
}

export interface BuildingConfig {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly queue: { readonly maxEntries: number };
  readonly resources: readonly BuildingResourceDefinition[];
  readonly buildings: readonly BuildingDefinition[];
}

export class BuildingConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`建筑配置无效 [${configPath}]: ${message}`);
    this.name = 'BuildingConfigError';
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
    if (!expectedSet.has(key)) throw new BuildingConfigError(pathKey(configPath, key), '不允许未知字段');
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new BuildingConfigError(pathKey(configPath, key), '缺少必需字段');
    }
  }
}

function stringField(value: Record<string, unknown>, key: string, configPath: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0 || field !== field.trim()) {
    throw new BuildingConfigError(pathKey(configPath, key), '必须是非空且无首尾空白的 string');
  }
  return field;
}

function integerField(value: Record<string, unknown>, key: string, configPath: string, minimum: number): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < minimum) {
    throw new BuildingConfigError(pathKey(configPath, key), `必须是大于等于 ${minimum} 的安全整数`);
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

function copyConfig(value: BuildingConfig): BuildingConfig {
  return {
    schemaVersion: 1,
    id: value.id,
    queue: { maxEntries: value.queue.maxEntries },
    resources: value.resources.map((resource) => ({ id: resource.id })),
    buildings: value.buildings.map((building) => ({
      id: building.id,
      initialLevel: building.initialLevel,
      maxLevel: building.maxLevel,
      upgrades: building.upgrades.map((upgrade) => ({
        targetLevel: upgrade.targetLevel,
        cost: { ...upgrade.cost },
        durationMs: upgrade.durationMs,
        prerequisites: upgrade.prerequisites.map((prerequisite) => ({ ...prerequisite })),
      })),
    })),
  };
}

export function assertBuildingConfig(value: unknown, configPath = 'meta/buildings/building-config'): asserts value is BuildingConfig {
  if (!isRecord(value)) throw new BuildingConfigError(configPath, '根值必须是 object');
  exactKeys(value, ['schemaVersion', 'id', 'queue', 'resources', 'buildings'], configPath);
  if (value.schemaVersion !== 1) throw new BuildingConfigError(pathKey(configPath, 'schemaVersion'), '必须是 1');
  stringField(value, 'id', configPath);

  const queuePath = pathKey(configPath, 'queue');
  if (!isRecord(value.queue)) throw new BuildingConfigError(queuePath, '必须是 object');
  exactKeys(value.queue, ['maxEntries'], queuePath);
  integerField(value.queue, 'maxEntries', queuePath, 1);

  const resourcePath = pathKey(configPath, 'resources');
  if (!Array.isArray(value.resources) || value.resources.length === 0) {
    throw new BuildingConfigError(resourcePath, '必须是非空 array');
  }
  const resourceIds = new Set<string>();
  value.resources.forEach((rawResource, index) => {
    const itemPath = `${resourcePath}[${index}]`;
    if (!isRecord(rawResource)) throw new BuildingConfigError(itemPath, '必须是 object');
    exactKeys(rawResource, ['id'], itemPath);
    const id = stringField(rawResource, 'id', itemPath);
    if (resourceIds.has(id)) throw new BuildingConfigError(pathKey(itemPath, 'id'), `重复资源 ID: ${id}`);
    resourceIds.add(id);
  });

  const buildingPath = pathKey(configPath, 'buildings');
  if (!Array.isArray(value.buildings) || value.buildings.length === 0) {
    throw new BuildingConfigError(buildingPath, '必须是非空 array');
  }
  const buildingIds = new Set<string>();
  value.buildings.forEach((rawBuilding, index) => {
    const itemPath = `${buildingPath}[${index}]`;
    if (!isRecord(rawBuilding)) throw new BuildingConfigError(itemPath, '必须是 object');
    const id = rawBuilding.id;
    if (typeof id === 'string' && id.length > 0 && id === id.trim()) {
      if (buildingIds.has(id)) throw new BuildingConfigError(pathKey(itemPath, 'id'), `重复建筑 ID: ${id}`);
      buildingIds.add(id);
    }
  });
  value.buildings.forEach((rawBuilding, index) => {
    const itemPath = `${buildingPath}[${index}]`;
    if (!isRecord(rawBuilding)) throw new BuildingConfigError(itemPath, '必须是 object');
    exactKeys(rawBuilding, ['id', 'initialLevel', 'maxLevel', 'upgrades'], itemPath);
    const id = stringField(rawBuilding, 'id', itemPath);
    const initialLevel = integerField(rawBuilding, 'initialLevel', itemPath, 1);
    const maxLevel = integerField(rawBuilding, 'maxLevel', itemPath, 1);
    if (initialLevel > maxLevel) {
      throw new BuildingConfigError(pathKey(itemPath, 'initialLevel'), '不能高于 maxLevel');
    }
    const upgradesPath = pathKey(itemPath, 'upgrades');
    if (!Array.isArray(rawBuilding.upgrades) || rawBuilding.upgrades.length !== maxLevel - 1) {
      throw new BuildingConfigError(upgradesPath, '必须完整提供从 2 到 maxLevel 的升级表');
    }
    rawBuilding.upgrades.forEach((rawUpgrade, upgradeIndex) => {
      const upgradePath = `${upgradesPath}[${upgradeIndex}]`;
      if (!isRecord(rawUpgrade)) throw new BuildingConfigError(upgradePath, '必须是 object');
      exactKeys(rawUpgrade, ['targetLevel', 'cost', 'durationMs', 'prerequisites'], upgradePath);
      const targetLevel = integerField(rawUpgrade, 'targetLevel', upgradePath, 2);
      if (targetLevel !== upgradeIndex + 2) {
        throw new BuildingConfigError(pathKey(upgradePath, 'targetLevel'), `必须按顺序为 ${upgradeIndex + 2}`);
      }
      integerField(rawUpgrade, 'durationMs', upgradePath, 1);

      const costPath = pathKey(upgradePath, 'cost');
      if (!isRecord(rawUpgrade.cost) || Object.keys(rawUpgrade.cost).length === 0) {
        throw new BuildingConfigError(costPath, '必须是非空 object');
      }
      for (const [resourceId, amount] of Object.entries(rawUpgrade.cost)) {
        if (!resourceIds.has(resourceId)) throw new BuildingConfigError(`${costPath}.${resourceId}`, '引用了不存在的资源');
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new BuildingConfigError(`${costPath}.${resourceId}`, '必须是正安全整数');
        }
      }

      const prerequisitesPath = pathKey(upgradePath, 'prerequisites');
      if (!Array.isArray(rawUpgrade.prerequisites)) {
        throw new BuildingConfigError(prerequisitesPath, '必须是 array');
      }
      const prerequisiteKeys = new Set<string>();
      rawUpgrade.prerequisites.forEach((rawPrerequisite, prerequisiteIndex) => {
        const prerequisitePath = `${prerequisitesPath}[${prerequisiteIndex}]`;
        if (!isRecord(rawPrerequisite)) throw new BuildingConfigError(prerequisitePath, '必须是 object');
        exactKeys(rawPrerequisite, ['buildingId', 'requiredLevel'], prerequisitePath);
        const prerequisiteBuildingId = stringField(rawPrerequisite, 'buildingId', prerequisitePath);
        if (!buildingIds.has(prerequisiteBuildingId)) {
          throw new BuildingConfigError(pathKey(prerequisitePath, 'buildingId'), '引用了不存在的建筑');
        }
        const requiredLevel = integerField(rawPrerequisite, 'requiredLevel', prerequisitePath, 1);
        const prerequisiteKey = `${prerequisiteBuildingId}:${requiredLevel}`;
        if (prerequisiteKeys.has(prerequisiteKey)) {
          throw new BuildingConfigError(prerequisitePath, '前置不能重复');
        }
        prerequisiteKeys.add(prerequisiteKey);
        if (prerequisiteBuildingId === id && requiredLevel >= targetLevel) {
          throw new BuildingConfigError(pathKey(prerequisitePath, 'requiredLevel'), '本建筑前置必须低于目标等级');
        }
      });
    });
  });

  // A prerequisite can refer only to a level that the referenced building can reach.
  value.buildings.forEach((rawBuilding, buildingIndex) => {
    const building = rawBuilding as Record<string, unknown>;
    const upgrades = building.upgrades as unknown[];
    upgrades.forEach((rawUpgrade, upgradeIndex) => {
      const prerequisites = (rawUpgrade as Record<string, unknown>).prerequisites as unknown[];
      prerequisites.forEach((rawPrerequisite, prerequisiteIndex) => {
        const prerequisite = rawPrerequisite as Record<string, unknown>;
        const referenced = value.buildings.find((candidate) => (candidate as Record<string, unknown>).id === prerequisite.buildingId) as Record<string, unknown>;
        const referencedMaxLevel = referenced.maxLevel as number;
        if ((prerequisite.requiredLevel as number) > referencedMaxLevel) {
          throw new BuildingConfigError(
            `${buildingPath}[${buildingIndex}].upgrades[${upgradeIndex}].prerequisites[${prerequisiteIndex}].requiredLevel`,
            '不能超过被引用建筑的 maxLevel',
          );
        }
      });
    });
  });
}

export function loadBuildingConfig(value: unknown, configPath = 'meta/buildings/building-config'): BuildingConfig {
  assertBuildingConfig(value, configPath);
  return deepFreeze(copyConfig(value));
}

export function findBuilding(config: BuildingConfig, buildingId: string): BuildingDefinition | undefined {
  return config.buildings.find((building) => building.id === buildingId);
}

export function findUpgrade(config: BuildingConfig, buildingId: string, targetLevel: number): BuildingUpgradeDefinition | undefined {
  return findBuilding(config, buildingId)?.upgrades.find((upgrade) => upgrade.targetLevel === targetLevel);
}
