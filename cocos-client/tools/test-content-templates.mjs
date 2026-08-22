import assert from 'node:assert/strict';
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

const levelContext = {
  levelIds: new Set(['L12']),
  deckIds: new Set(['D002']),
  targetIds: new Set(['BOSS-EMBER-LORD']),
  rewardIds: new Set(['GOLD', 'EMBER-CHEST']),
};

const dungeonContext = {
  enemyIds: new Set([
    'normal-scout', 'normal-guard', 'normal-lord',
    'hard-scout', 'hard-guard', 'hard-lord',
  ]),
  rewardIds: new Set(['GOLD', 'DUNGEON-TOKEN']),
};

const towerContext = {
  enemyUnitIds: new Set(['U001', 'U002', 'U003', 'U004', 'U005', 'U006']),
  previousFloor: {
    floor: 12,
    stageId: 'STAGE_03',
    enemyPoolId: 'POOL_03',
    enemyIds: ['U001', 'U002'],
    rules: {
      threatMultiplierPercent: 150,
      maxEnemyUnits: 2,
      enemyActionInterval: 3,
      maxRounds: 42,
      randomness: 240,
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
  rewardIds: new Set([...levelContext.rewardIds, ...dungeonContext.rewardIds]),
  enemyIds: dungeonContext.enemyIds,
  enemyUnitIds: towerContext.enemyUnitIds,
  unitIds: bossContext.unitIds,
  previousFloor: towerContext.previousFloor,
};

const levelInput = {
  id: 'L13',
  resource: 'config/levels/generated/L13',
  prerequisiteLevelId: 'L12',
  enemyDeckId: 'D002',
  environmentElement: 'FIRE',
  objectives: [
    { type: 'DEFEAT_ENEMY_HERO' },
    { type: 'SURVIVE_ROUNDS', rounds: 12 },
  ],
  rewards: [
    { type: 'CARD', id: 'GOLD', quantity: 2, cardType: 'UNIT' },
    { type: 'CHEST', id: 'EMBER-CHEST', quantity: 1 },
  ],
  failureConditions: [{ type: 'PLAYER_HERO_DEFEATED' }],
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
  enemyIds: null,
  enemyPoolUnitIds: ['U001', 'U002', 'U003', 'U004', 'U005', 'U006'],
  enemyCount: 3,
  seed: 20260822,
  rules: {
    threatMultiplierPercent: 155,
    maxEnemyUnits: 3,
    enemyActionInterval: 2,
    maxRounds: 40,
    randomness: 220,
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
assert.equal(dungeon.config.length, 2);
assert.equal(tower.config.floor, 13);
assert.deepEqual(tower.config.enemyIds, generateTowerFloor(towerInput, towerContext).config.enemyIds, 'same seed must produce the same enemy selection');
assert.notDeepEqual(
  tower.config.enemyIds,
  generateTowerFloor({ ...towerInput, seed: towerInput.seed + 1 }, towerContext).config.enemyIds,
  'different seeds must not collapse to one fixed enemy selection',
);
assert.equal(boss.config.id, 'BOSS-EMBER-LORD');
assert(Object.isFrozen(level) && Object.isFrozen(level.config.chapterLevels[0]), 'generated entries must be deeply frozen');
assert.equal(canonicalJson(level), canonicalJson(generateLevel(levelInput, levelContext)), 'canonical serialization must be stable');

validateDungeonDifficultyConfig(dungeon.config);
validateBossConfig(boss.config);
validateContentEntry(level, levelContext);
validateContentEntry(dungeon, dungeonContext);
validateContentEntry(tower, towerContext);
validateContentEntry(boss, bossContext);

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

expectRejected('level missing deck reference', () => generateLevel({ ...levelInput, enemyDeckId: 'D999' }, levelContext), 'MISSING_REFERENCE');
expectRejected('level self prerequisite', () => generateLevel({ ...levelInput, id: 'L12', prerequisiteLevelId: 'L12' }, levelContext), 'REFERENCE_CYCLE');
expectRejected('level invalid target reference', () => generateLevel({ ...levelInput, objectives: [{ type: 'DESTROY_TARGET', targetId: 'TARGET-999' }] }, levelContext), 'MISSING_REFERENCE');
expectRejected('level invalid objective boundary', () => generateLevel({ ...levelInput, objectives: [{ type: 'SURVIVE_ROUNDS', rounds: 0 }] }, levelContext), 'BOUNDARY');
expectRejected('level unknown field', () => generateLevel({ ...levelInput, cheat: true }, levelContext), 'UNKNOWN_FIELD');
expectRejected('dungeon must contain three stages', () => generateDungeon({ ...dungeonInput, difficulties: dungeonInput.difficulties.map((item) => ({ ...item, stages: item.stages.slice(0, 2) })) }, dungeonContext), 'BOUNDARY');
expectRejected('dungeon duplicate enemy reference', () => generateDungeon({ ...dungeonInput, difficulties: dungeonInput.difficulties.map((item) => ({ ...item, stages: item.stages.map((stage, index) => index === 1 ? { ...stage, enemy: { ...stage.enemy, id: item.stages[0].enemy.id } } : stage) })) }, dungeonContext), 'DUPLICATE_ID');
expectRejected('dungeon self unlock', () => generateDungeon({ ...dungeonInput, difficulties: dungeonInput.difficulties.map((item) => item.id === 'HARD' ? { ...item, unlock: { type: 'clearCount', difficultyId: 'HARD', minimumClears: 1 } } : item) }, dungeonContext), 'REFERENCE_CYCLE');
expectRejected('tower floor below boundary', () => generateTowerFloor({ ...towerInput, floor: 0 }, towerContext), 'BOUNDARY');
expectRejected('tower floor above boundary', () => generateTowerFloor({ ...towerInput, floor: TOWER_FLOOR_MAX + 1 }, towerContext), 'BOUNDARY');
expectRejected('tower unknown enemy reference', () => generateTowerFloor({ ...towerInput, enemyIds: ['U999'] }, towerContext), 'MISSING_REFERENCE');
expectRejected('tower progression regression', () => generateTowerFloor({ ...towerInput, rules: { ...towerInput.rules, threatMultiplierPercent: 150 } }, towerContext), 'PROGRESSION');
expectRejected('tower seed boundary', () => generateTowerFloor({ ...towerInput, seed: -1 }, towerContext), 'BOUNDARY');
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

console.log(`T254 content templates PASS: entries=${pack.entries.length}, tower-floor=${tower.config.floor}, boss-phases=${boss.config.phases.length}, negative-cases=${negativeCases}`);
