import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ContentTemplateError,
  TOWER_FLOOR_MAX,
  canonicalJson,
  generateBoss,
  generateContentPack,
  generateDungeon,
  generateLevel,
  generateTowerFloor,
  validateContentEntry,
  validateContentPack,
} from './content-templates/index.mjs';
import { validateDungeonDifficultyConfig } from '../assets/scripts/pve/dungeon/difficulty/DungeonDifficulty.ts';
import { validateBossConfig } from '../assets/scripts/core/boss/index.ts';
import { createTowerConfig, loadTowerConfig } from '../assets/scripts/pve/tower/TowerConfig.ts';

const projectRoot = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(projectRoot, 'assets/resources/config');
const loaderSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const levelProductionSource = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", "const JsonAsset=class {}; const resources={load(){throw new Error('not used')}};")}\nexport { assertChapterLevelRuleSchemas };\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const {
  assertChapterLevelContract,
  assertChapterLevelRuleSchemas,
  ConfigLoadError,
} = await import(`data:text/javascript;base64,${Buffer.from(levelProductionSource).toString('base64')}`);

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(configRoot, relativePath), 'utf8'));
const productionManifest = readJson('manifest.json');
const productionDecks = readJson('decks.json');
const productionCards = readJson('cards.json');
const productionUnits = readJson('units.json');
const productionSkills = readJson('skills.json');
const productionLevelIndex = readJson('levels/chapter01/index.json');
const productionEnumCoverage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'), 'utf8'));
const productionUnitIds = new Set(productionUnits.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id));
const productionSkillIds = new Set(productionSkills.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.id));
const productionCardsById = new Map(productionCards.cards.filter((card) => card.enabled !== false).map((card) => [card.id, {
  cardType: card.cardType,
  copyLimit: card.copyLimit,
  ...(card.unitId ? { unitId: card.unitId } : {}),
  ...(card.skillId ? { skillId: card.skillId } : {}),
}]));
const productionRewardIds = (type) => new Set(productionEnumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));

const levelContext = {
  levelIds: new Set(['L11']),
  chapterLevelIds: new Set(productionLevelIndex.levels.map((entry) => entry.id)),
  deckIds: new Set(['D001']),
  targetIds: new Set(['C010', ...productionUnitIds]),
  unitIds: productionUnitIds,
  skillIds: productionSkillIds,
  cards: productionCardsById,
  unlockIds: productionRewardIds('UNLOCK'),
  chestIds: productionRewardIds('CHEST'),
  flagIds: productionRewardIds('FLAG'),
};

const dungeonContext = {
  enemyIds: new Set([
    'normal-scout', 'normal-guard', 'normal-lord',
    'hard-scout', 'hard-guard', 'hard-lord',
  ]),
  rewardIds: new Set(['GOLD', 'DUNGEON-TOKEN']),
};

const towerContext = {
  enemyUnitIds: new Set(Array.from({ length: 28 }, (_item, index) => `U${String(index + 1).padStart(3, '0')}`)),
  stageIds: new Set(Array.from({ length: 10 }, (_item, index) => `STAGE_${String(index + 1).padStart(2, '0')}`)),
  enemyPoolIds: new Set(Array.from({ length: 10 }, (_item, index) => `POOL_${String(index + 1).padStart(2, '0')}`)),
  stages: createTowerConfig().stages,
  enemyPools: createTowerConfig().enemyPools,
  previousFloor: {
    floor: 12,
    stageId: 'STAGE_03',
    enemyPoolId: 'POOL_03',
    enemyIds: ['U014', 'U009', 'U010'],
    rules: {
      threatMultiplierPercent: 155,
      maxEnemyUnits: 3,
      enemyActionInterval: 4,
      maxRounds: 42,
      randomness: 423,
      environmentElement: 'WOOD',
      specialRule: 'ELEMENTAL_SURGE',
    },
  },
};

const bossContext = { unitIds: new Set(['U001', 'U002']) };
const allContext = {
  levelIds: levelContext.levelIds,
  deckIds: levelContext.deckIds,
  targetIds: levelContext.targetIds,
  rewardIds: new Set([...dungeonContext.rewardIds]),
  ...levelContext,
  enemyIds: dungeonContext.enemyIds,
  enemyUnitIds: towerContext.enemyUnitIds,
  stageIds: towerContext.stageIds,
  enemyPoolIds: towerContext.enemyPoolIds,
  stages: towerContext.stages,
  enemyPools: towerContext.enemyPools,
  unitIds: bossContext.unitIds,
  previousFloor: towerContext.previousFloor,
};

const levelInput = {
  id: 'L12',
  prerequisiteLevelId: 'L11',
  enemyDeckId: 'D001',
  environmentElement: 'NONE',
  objectives: [
    { type: 'DEFEAT_ENEMY_HERO' },
    { type: 'SURVIVE_ROUNDS', rounds: 12 },
  ],
  rewards: [
    { type: 'CARD', id: 'U001', quantity: 2 },
    { type: 'CHEST', id: 'CHAPTER-CHEST', quantity: 1 },
  ],
  failureConditions: [
    { type: 'PLAYER_HERO_DEFEATED' },
    { type: 'ROUND_LIMIT_REACHED', rounds: 80 },
  ],
  scenarioRules: {
    sceneId: 'E112',
    bossCharacterId: 'C010',
    roundLimit: 80,
    pointBookRule: {
      enemyActionInterval: 3,
      summonUnitId: 'U009',
      occupiedSlotPolicy: 'SKIP',
      overwriteUnits: false,
    },
    phaseTransition: {
      triggerBossHpPercent: 50,
      bossEntersBattle: true,
      bossRole: 'HIGH_HP_ELITE',
      nameLockAffects: ['SKILL_CARD'],
      unitCardPreparationNormal: true,
    },
    victoryPolicy: 'DEFEAT_BOSS_AND_KEEP_PLAYER_HERO_ALIVE',
    rewardRegistryIds: ['CHAPTER-CHEST', 'OUTCAST-CAMP'],
  },
};

const dungeonInput = {
  id: 'DUNGEON-EMBER',
  resource: 'config/dungeons/DUNGEON-EMBER',
  difficulties: [
    {
      id: 'NORMAL',
      displayName: '普通',
      attemptLimit: 3,
      unlock: { type: 'always' },
      stages: [
        { id: 'DUNGEON-01', enemy: { id: 'normal-scout', hp: 90, attack: 12, defense: 3 } },
        { id: 'DUNGEON-02', enemy: { id: 'normal-guard', hp: 115, attack: 15, defense: 5 } },
        { id: 'DUNGEON-03', enemy: { id: 'normal-lord', hp: 150, attack: 20, defense: 7 } },
      ],
      firstClearRewards: [{ id: 'GOLD', quantity: 180 }, { id: 'DUNGEON-TOKEN', quantity: 1 }],
      repeatClearRewards: [{ id: 'GOLD', quantity: 60 }],
    },
    {
      id: 'HARD',
      displayName: '困难',
      attemptLimit: 2,
      unlock: { type: 'clearCount', difficultyId: 'NORMAL', minimumClears: 1 },
      stages: [
        { id: 'DUNGEON-01', enemy: { id: 'hard-scout', hp: 150, attack: 19, defense: 6 } },
        { id: 'DUNGEON-02', enemy: { id: 'hard-guard', hp: 190, attack: 24, defense: 9 } },
        { id: 'DUNGEON-03', enemy: { id: 'hard-lord', hp: 250, attack: 32, defense: 12 } },
      ],
      firstClearRewards: [{ id: 'GOLD', quantity: 420 }, { id: 'DUNGEON-TOKEN', quantity: 2 }],
      repeatClearRewards: [{ id: 'GOLD', quantity: 140 }],
    },
  ],
};

const towerInput = {
  id: 'TOWER-FLOOR-13',
  resource: 'config/tower/floors/TOWER-FLOOR-13',
  floor: 13,
  stageId: 'STAGE_03',
  enemyPoolId: 'POOL_03',
  enemyIds: ['U009', 'U010', 'U011'],
  rules: {
    threatMultiplierPercent: 160,
    maxEnemyUnits: 3,
    enemyActionInterval: 4,
    maxRounds: 42,
    randomness: 416,
    environmentElement: 'WOOD',
    specialRule: 'ELEMENTAL_SURGE',
  },
};

const bossInput = {
  id: 'BOSS-EMBER-LORD',
  resource: 'config/bosses/BOSS-EMBER-LORD',
  maxHp: 100,
  flags: ['sealBroken'],
  summons: [{ id: 'emberling', unitId: 'U001', maxHp: 12, maxActive: 1 }],
  skills: [
    { id: 'heavy-strike', effect: { type: 'DAMAGE_PLAYER_HERO', amount: 7 } },
    { id: 'seal-break', effect: { type: 'SET_FLAG', flag: 'sealBroken', value: true } },
    { id: 'call-emberling', effect: { type: 'SUMMON', summonId: 'emberling' } },
  ],
  phases: [
    { id: 'P1', hpPercentAtMost: 100, skillIds: ['heavy-strike', 'call-emberling'], onEnterSummonIds: ['emberling'] },
    { id: 'P2', hpPercentAtMost: 50, skillIds: ['heavy-strike', 'seal-break'], onEnterSummonIds: [] },
  ],
  outcome: {
    priority: 'LOSE',
    win: { mode: 'ALL', rules: [{ type: 'BOSS_HP_AT_MOST', value: 0 }, { type: 'FLAG_SET', flag: 'sealBroken' }] },
    lose: { mode: 'ANY', rules: [{ type: 'PLAYER_HERO_HP_AT_MOST', value: 0 }, { type: 'ROUND_AT_LEAST', value: 5 }] },
  },
};

let negativeCases = 0;
function expectRejected(label, mutate, expectedCode) {
  negativeCases += 1;
  assert.throws(() => mutate(), (error) => {
    assert(error instanceof ContentTemplateError, `${label} must use ContentTemplateError`);
    if (expectedCode) assert.equal(error.code, expectedCode, `${label} error code`);
    return true;
  }, label);
}

const level = generateLevel(levelInput, levelContext);
const dungeon = generateDungeon(dungeonInput, dungeonContext);
const tower = generateTowerFloor(towerInput, towerContext);
const boss = generateBoss(bossInput, bossContext);

assert.equal(level.type, 'level');
assert.deepEqual(level.config.chapterLevels[0], (({ resource: _resource, ...config }) => config)(levelInput), 'level output must not leak template metadata');
assert.equal(level.resource, 'config/levels/generated/L12', 'omitted level resource must use the production-safe default');
assert.equal(dungeon.config.length, 2);
assert.equal(tower.config.floor, 13);
assert.deepEqual(tower.config.enemyIds, ['U009', 'U010', 'U011'], 'tower output must use the production fixed progression sequence');
assert.deepEqual(tower.config.enemyIds, generateTowerFloor(towerInput, towerContext).config.enemyIds, 'explicit tower enemy selection must be deterministic');
assert.equal(boss.config.id, 'BOSS-EMBER-LORD');
assert(Object.isFrozen(level) && Object.isFrozen(level.config.chapterLevels[0]), 'generated entries must be deeply frozen');
assert.equal(canonicalJson(level), canonicalJson(generateLevel(levelInput, levelContext)), 'canonical serialization must be stable');

validateDungeonDifficultyConfig(dungeon.config);
validateBossConfig(boss.config);
validateContentEntry(level, levelContext);
validateContentEntry(dungeon, dungeonContext);
validateContentEntry(tower, towerContext);
validateContentEntry(boss, bossContext);

assertChapterLevelRuleSchemas(level.config.chapterLevels[0], level.id, 'config/levels/generated/L12.chapterLevels[0]');
assert.doesNotThrow(
  () => assertChapterLevelContract(level.config, productionManifest, productionDecks, {
    chapterLevelIds: levelContext.chapterLevelIds,
    targetIds: levelContext.targetIds,
    unitIds: productionUnitIds,
    skillIds: productionSkillIds,
    cards: productionCardsById,
    unlockIds: levelContext.unlockIds,
    chestIds: levelContext.chestIds,
    flagIds: levelContext.flagIds,
  }, 'config/levels/generated/L12'),
  'generated level must satisfy the production chapter-level contract',
);
assert.doesNotThrow(() => {
  const productionTower = structuredClone(createTowerConfig());
  productionTower.floors[tower.config.floor - 1] = tower.config;
  loadTowerConfig(productionTower);
}, 'generated tower floor must be accepted by the production tower loader');

const productionTower = structuredClone(createTowerConfig());
let previousGeneratedFloor;
const generatedTowerFloors = productionTower.floors.map((floorConfig, index) => {
  const generated = generateTowerFloor({
    id: `TOWER-FLOOR-${String(index + 1).padStart(2, '0')}`,
    ...floorConfig,
  }, {
    ...towerContext,
    previousFloor: previousGeneratedFloor,
  });
  assert.deepEqual(generated.config, floorConfig, `generated tower floor ${index + 1} must match production formula`);
  previousGeneratedFloor = generated.config;
  return generated.config;
});
productionTower.floors = generatedTowerFloors;
assert.doesNotThrow(() => loadTowerConfig(productionTower), 'all 50 generated tower floors must pass the production loader');

const pack = generateContentPack([
  { type: 'boss', input: bossInput },
  { type: 'level', input: levelInput },
  { type: 'tower-floor', input: towerInput },
  { type: 'dungeon', input: dungeonInput },
], allContext);
assert.deepEqual(pack.entries.map(({ type }) => type), ['boss', 'dungeon', 'level', 'tower-floor'], 'pack order must be deterministic');
assert.equal(validateContentPack(pack, allContext), true);
assert.deepEqual(pack, generateContentPack([
  { type: 'tower-floor', input: towerInput },
  { type: 'level', input: levelInput },
  { type: 'boss', input: bossInput },
  { type: 'dungeon', input: dungeonInput },
], allContext), 'pack generation must be input-order independent');

assert.doesNotThrow(() => generateLevel(levelInput, { validationMode: 'permissive' }), 'permissive mode must be explicit for pure template tests');
expectRejected('level production registry missing', () => generateLevel(levelInput), 'MISSING_REFERENCE');
expectRejected('level target registry missing', () => generateLevel({ ...levelInput, objectives: [{ type: 'DESTROY_TARGET', targetId: 'C010' }] }, { ...levelContext, targetIds: undefined }), 'MISSING_REFERENCE');
expectRejected('level chapter registry missing', () => generateLevel(levelInput, { ...levelContext, chapterLevelIds: undefined }), 'MISSING_REFERENCE');
expectRejected('level reward conflicts with deck', () => generateLevel({
  ...levelInput,
  rewards: [{ type: 'UNLOCK', id: 'D001', quantity: 1 }],
}, { ...levelContext, unlockIds: new Set(['D001']) }), 'MISMATCHED_REFERENCE');
expectRejected('level reward conflicts with target', () => generateLevel({
  ...levelInput,
  rewards: [{ type: 'UNLOCK', id: 'C010', quantity: 1 }],
}, { ...levelContext, unlockIds: new Set(['C010']) }), 'MISMATCHED_REFERENCE');
expectRejected('level reward conflicts with chapter level', () => generateLevel({
  ...levelInput,
  rewards: [{ type: 'UNLOCK', id: 'L11', quantity: 1 }],
}, { ...levelContext, unlockIds: new Set(['L11']) }), 'MISMATCHED_REFERENCE');
expectRejected('level non-card reward rejects cardType field', () => generateLevel({
  ...levelInput,
  rewards: [{ type: 'UNLOCK', id: 'OUTPOST', quantity: 1, cardType: 'UNIT' }],
}, levelContext), 'UNKNOWN_FIELD');
expectRejected('level card registry metadata reference', () => generateLevel(levelInput, {
  ...levelContext,
  cards: new Map([...levelContext.cards.entries()].map(([id, card]) => [id, id === 'U001' ? { ...card, unitId: 'U999' } : card])),
}), 'MISSING_REFERENCE');
expectRejected('tower production registry missing', () => generateTowerFloor(towerInput, { ...towerContext, enemyPoolIds: undefined }), 'MISSING_REFERENCE');
expectRejected('tower stage registry missing', () => generateTowerFloor(towerInput, { ...towerContext, stages: undefined }), 'MISSING_REFERENCE');
expectRejected('tower floor requires previous floor', () => generateTowerFloor(towerInput, { ...towerContext, previousFloor: undefined }), 'PROGRESSION');
expectRejected('tower floor id mismatch', () => generateTowerFloor({ ...towerInput, id: 'TOWER-FLOOR-12' }, towerContext), 'MISMATCHED_REFERENCE');
expectRejected('tower fixed multiplier formula', () => generateTowerFloor({
  ...towerInput,
  rules: { ...towerInput.rules, threatMultiplierPercent: 155 },
}, towerContext), 'PROGRESSION');
expectRejected('tower fixed max rounds formula', () => generateTowerFloor({
  ...towerInput,
  rules: { ...towerInput.rules, maxRounds: 45 },
}, towerContext), 'PROGRESSION');
expectRejected('tower stage environment contract', () => generateTowerFloor({
  ...towerInput,
  rules: { ...towerInput.rules, environmentElement: 'FIRE' },
}, towerContext), 'MISMATCHED_REFERENCE');

const pollutedModuleUrl = pathToFileURL(path.join(projectRoot, 'tools/content-templates/index.mjs')).href;
const pollutedInput = JSON.stringify(levelInput);
const pollutionProbe = [
  `Object.defineProperty(Object.prototype, 'preImportPolluted', { value: true, configurable: true });`,
  `const { generateLevel } = await import(${JSON.stringify(pollutedModuleUrl)});`,
  `try { generateLevel(${pollutedInput}); process.exit(1); }`,
  `catch (error) { if (error?.code !== 'INJECTION') process.exit(2); process.stdout.write('pollution-rejected'); }`,
].join('\n');
assert.equal(
  execFileSync(process.execPath, ['--input-type=module', '-e', pollutionProbe], { encoding: 'utf8' }),
  'pollution-rejected',
  'module must reject Object.prototype pollution that happened before dynamic import',
);

expectRejected('level missing deck reference', () => generateLevel({ ...levelInput, enemyDeckId: 'D999' }, levelContext), 'MISSING_REFERENCE');
expectRejected('level self prerequisite', () => generateLevel({ ...levelInput, id: 'L12', prerequisiteLevelId: 'L12' }, levelContext), 'REFERENCE_CYCLE');
expectRejected('level invalid target reference', () => generateLevel({ ...levelInput, objectives: [{ type: 'DESTROY_TARGET', targetId: 'TARGET-999' }] }, levelContext), 'MISSING_REFERENCE');
expectRejected('level invalid objective boundary', () => generateLevel({ ...levelInput, objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 0 }] }, levelContext), 'BOUNDARY');
expectRejected('level card type reference mismatch', () => generateLevel({ ...levelInput, rewards: [{ type: 'CARD', id: 'U001', quantity: 1, cardType: 'SKILL' }] }, levelContext), 'MISMATCHED_REFERENCE');
expectRejected('level card copy limit', () => generateLevel({ ...levelInput, rewards: [{ type: 'CARD', id: 'U001', quantity: 5 }] }, levelContext), 'BOUNDARY');
expectRejected('level untyped reward registry', () => {
  const context = { ...levelContext };
  delete context.cards;
  delete context.chestIds;
  generateLevel(levelInput, { ...context, rewardIds: new Set(['U001', 'CHAPTER-CHEST']) });
}, 'INVALID_CONTEXT');
expectRejected('level round failure requires rounds', () => generateLevel({ ...levelInput, failureConditions: [{ type: 'ROUND_LIMIT_REACHED' }] }, levelContext), 'MISSING_FIELD');
expectRejected('level nested rule unknown field', () => generateLevel({ ...levelInput, scenarioRules: { ...levelInput.scenarioRules, phaseTransition: { ...levelInput.scenarioRules.phaseTransition, cheat: true } } }, levelContext), 'UNKNOWN_FIELD');
expectRejected('level unknown field', () => generateLevel({ ...levelInput, cheat: true }, levelContext), 'UNKNOWN_FIELD');
expectRejected('dungeon must contain three stages', () => generateDungeon({ ...dungeonInput, difficulties: dungeonInput.difficulties.map((item) => ({ ...item, stages: item.stages.slice(0, 2) })) }, dungeonContext), 'BOUNDARY');
expectRejected('dungeon duplicate enemy reference', () => generateDungeon({ ...dungeonInput, difficulties: dungeonInput.difficulties.map((item) => ({ ...item, stages: item.stages.map((stage, index) => index === 1 ? { ...stage, enemy: { ...stage.enemy, id: item.stages[0].enemy.id } } : stage) })) }, dungeonContext), 'DUPLICATE_ID');
expectRejected('dungeon self unlock', () => generateDungeon({ ...dungeonInput, difficulties: dungeonInput.difficulties.map((item) => item.id === 'HARD' ? { ...item, unlock: { type: 'clearCount', difficultyId: 'HARD', minimumClears: 1 } } : item) }, dungeonContext), 'REFERENCE_CYCLE');
expectRejected('tower floor below boundary', () => generateTowerFloor({ ...towerInput, floor: 0 }, towerContext), 'BOUNDARY');
expectRejected('tower floor above boundary', () => generateTowerFloor({ ...towerInput, floor: TOWER_FLOOR_MAX + 1 }, towerContext), 'BOUNDARY');
expectRejected('tower unknown enemy reference', () => generateTowerFloor({ ...towerInput, enemyIds: ['U999', 'U998', 'U009'] }, towerContext), 'MISSING_REFERENCE');
expectRejected('tower stage context reference', () => generateTowerFloor(towerInput, { ...towerContext, stageIds: new Set(['STAGE_01']) }), 'MISSING_REFERENCE');
expectRejected('tower pool context reference', () => generateTowerFloor(towerInput, { ...towerContext, enemyPoolIds: new Set(['POOL_01']) }), 'MISSING_REFERENCE');
expectRejected('tower floor and stage mismatch', () => generateTowerFloor({ ...towerInput, stageId: 'STAGE_02', enemyPoolId: 'POOL_02' }, towerContext), 'MISMATCHED_REFERENCE');
expectRejected('tower enemy quantity lower boundary', () => generateTowerFloor({ ...towerInput, enemyIds: ['U009'] }, towerContext), 'BOUNDARY');
expectRejected('tower fixed sequence mismatch', () => generateTowerFloor({ ...towerInput, enemyIds: ['U010', 'U011', 'U012'] }, towerContext), 'PROGRESSION');
expectRejected('tower progression regression', () => generateTowerFloor({ ...towerInput, rules: { ...towerInput.rules, threatMultiplierPercent: 150 } }, towerContext), 'PROGRESSION');
expectRejected('tower random seed is fail-closed', () => generateTowerFloor({ ...towerInput, seed: 1 }, towerContext), 'UNKNOWN_FIELD');
expectRejected('boss unknown skill reference', () => generateBoss({ ...bossInput, phases: [{ ...bossInput.phases[0], skillIds: ['forged'] }, bossInput.phases[1]] }, bossContext), 'MISSING_REFERENCE');
expectRejected('boss unknown summon reference', () => generateBoss({ ...bossInput, skills: [{ ...bossInput.skills[2], effect: { type: 'SUMMON', summonId: 'forged' } }, ...bossInput.skills.slice(0, 2)] }, bossContext), 'MISSING_REFERENCE');
expectRejected('boss phase boundary', () => generateBoss({ ...bossInput, phases: [{ ...bossInput.phases[0], hpPercentAtMost: 101 }, bossInput.phases[1]] }, bossContext), 'BOUNDARY');
expectRejected('boss unknown field', () => generateBoss({ ...bossInput, phases: [{ ...bossInput.phases[0], cheat: true }, bossInput.phases[1]] }, bossContext), 'UNKNOWN_FIELD');
expectRejected('path traversal', () => generateLevel({ ...levelInput, resource: '../outside' }, levelContext), 'PATH_ESCAPE');
expectRejected('absolute path', () => generateBoss({ ...bossInput, resource: '/tmp/escape' }, bossContext), 'PATH_ESCAPE');
expectRejected('backslash path', () => generateDungeon({ ...dungeonInput, resource: 'config\\escape' }, dungeonContext), 'PATH_ESCAPE');
expectRejected('duplicate pack id', () => generateContentPack([{ type: 'level', input: levelInput }, { type: 'level', input: { ...levelInput, resource: 'config/levels/generated/L13-copy' } }], levelContext), 'DUPLICATE_ID');
expectRejected('pack unknown field', () => generateContentPack([{ type: 'level', input: levelInput, extra: true }], levelContext), 'UNKNOWN_FIELD');
expectRejected('prototype pollution key', () => generateLevel(JSON.parse('{"id":"L13","resource":"config/levels/generated/L13","prerequisiteLevelId":"L12","enemyDeckId":"D002","environmentElement":"NONE","objectives":[{"type":"DEFEAT_ENEMY_HERO"}],"rewards":[{"type":"CARD","id":"GOLD","quantity":1,"cardType":"UNIT"}],"failureConditions":[{"type":"PLAYER_HERO_DEFEATED"}],"__proto__":{"polluted":true}}'), levelContext), 'INJECTION');
expectRejected('custom prototype', () => generateLevel(Object.assign(Object.create({ polluted: true }), levelInput), levelContext), 'INJECTION');
expectRejected('symbol injection', () => {
  const candidate = { ...levelInput };
  Object.defineProperty(candidate, Symbol('inject'), { value: true, enumerable: true });
  generateLevel(candidate, levelContext);
}, 'INJECTION');
expectRejected('Object.prototype pollution', () => {
  Object.defineProperty(Object.prototype, 'contentTemplatePolluted', { value: true, configurable: true });
  try {
    generateLevel(levelInput, levelContext);
  } finally {
    delete Object.prototype.contentTemplatePolluted;
  }
}, 'INJECTION');

assert(negativeCases >= 26, `negative case coverage must remain at least 26, got ${negativeCases}`);
console.log(`T254 content templates PASS: entries=${pack.entries.length}, tower-floor=${tower.config.floor}, boss-phases=${boss.config.phases.length}, negative-cases=${negativeCases}`);
