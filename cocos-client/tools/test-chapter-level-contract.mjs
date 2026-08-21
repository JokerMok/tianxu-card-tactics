import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readConfigResource = (resourcePath) => {
  assert(resourcePath.startsWith('config/'), `config resource must be rooted at config/: ${resourcePath}`);
  return readJson(path.join(root, 'assets/resources', `${resourcePath}.json`));
};
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const mockCcSource = `
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: { load() { throw new Error('not used by chapter level contract'); } },
};
`;
const executableSource = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`)}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(
  `data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`,
);

const manifest = readConfigResource('config/manifest');
const chapterIndex = readConfigResource(manifest.chapters.chapter01);
const cards = readConfigResource(manifest.tables.cards);
const units = readConfigResource(manifest.tables.units);
const skills = readConfigResource(manifest.tables.skills);
const decks = readConfigResource(manifest.tables.decks);
const enumCoverageFixture = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'), 'utf8'),
);

// 来源：manifest.chapters.chapter01 指向的真实章节注册表。
const chapterLevelIds = new Set(chapterIndex.levels.map((level) => level.id));
// 运行时注册表由真实单位表与章节索引 targetIds 合并而成；L10 的 U001/U004 与 L03/L08 的 C002/C009 均须可解析。
const targetIds = new Set(units.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id));
chapterIndex.targetIds.forEach((id) => targetIds.add(id));
const unitIds = new Set(units.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id));
const skillIds = new Set(skills.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.id));
// 来源：真实 cards.json；保留 cardType/copyLimit 元数据供奖励契约核对。
const cardReferences = new Map(
  cards.cards
    .filter((card) => card.enabled !== false)
    .map((card) => [card.id, {
      cardType: card.cardType,
      copyLimit: card.copyLimit,
      ...(card.unitId ? { unitId: card.unitId } : {}),
      ...(card.skillId ? { skillId: card.skillId } : {}),
    }]),
);
// 来源：manifest.chapters.chapter01 指向的真实章节奖励注册表。
const references = {
  chapterLevelIds,
  targetIds,
  unitIds,
  skillIds,
  cards: cardReferences,
  unlockIds: new Set(chapterIndex.rewardRegistries.unlockIds),
  chestIds: new Set(chapterIndex.rewardRegistries.chestIds),
  flagIds: new Set(chapterIndex.rewardRegistries.flagIds),
};

const realLevelDocuments = chapterIndex.levels.map((entry) => {
  const document = readConfigResource(entry.resource);
  assert.equal(document.chapterLevels?.length, 1, `${entry.id} must contain exactly one real chapter level`);
  assert.equal(document.chapterLevels[0].id, entry.id, `${entry.id} document ID must match the real chapter index`);
  assert.equal(
    document.chapterLevels[0].prerequisiteLevelId,
    entry.prerequisiteLevelId,
    `${entry.id} prerequisite must match the real chapter index`,
  );
  return document;
});

realLevelDocuments.forEach((document, index) => {
  const entry = chapterIndex.levels[index];
  assert.doesNotThrow(
    () => assertChapterLevelContract(document, manifest, decks, references, entry.resource),
    `${entry.id} real level document must pass the shared chapter level contract`,
  );
});
assert.doesNotThrow(
  () => assertChapterLevelContract({ chapterLevels: realLevelDocuments.map((document) => document.chapterLevels[0]) }, manifest, decks, references),
  'all twelve real chapter level documents must pass the shared contract together',
);

const skillCardId = cards.cards.find((card) => card.cardType === 'SKILL')?.id;
assert.equal(typeof skillCardId, 'string', 'real cards.json must provide a skill card for the negative case');
const valid = {
  chapterLevels: [{
    id: 'L01',
    prerequisiteLevelId: null,
    enemyDeckId: 'D001',
    environmentElement: 'NONE',
    objectives: [
      { type: 'DEFEAT_ENEMY_HERO' },
      { type: 'PROTECT_TARGET', targetId: 'U001' },
      { type: 'SURVIVE_ROUNDS', rounds: 3 },
    ],
    rewards: [{ type: 'CARD', id: 'U001', quantity: 4 }],
    failureConditions: [
      { type: 'PLAYER_HERO_DEFEATED' },
      { type: 'TARGET_DESTROYED', targetId: 'U001' },
    ],
  }],
};

// Cocos Creator 3.8.8 将 new Set([...unitIds, ...index.targetIds]) 转译为
// new Set([].concat(unitIds, index.targetIds))；实际结果是外层 Set 包含内层 Set 与 Array。
const cocosTranspiledReferences = {
  ...references,
  targetIds: new Set([unitIds, chapterIndex.targetIds]),
  unitIds: new Set([unitIds]),
};

assert.doesNotThrow(
  () => assertChapterLevelContract(valid, manifest, decks, cocosTranspiledReferences),
  'a nested Cocos-transpiled target/unit registry must still allow legal U001 references',
);
const cocosIteratorReferences = {
  ...references,
  chapterLevelIds: new Set([chapterLevelIds.values()]),
  targetIds: new Set([unitIds.values(), chapterIndex.targetIds.values()]),
  unitIds: new Set([unitIds.values()]),
  skillIds: new Set([skillIds.values()]),
  unlockIds: new Set([chapterIndex.rewardRegistries.unlockIds.values()]),
  chestIds: new Set([chapterIndex.rewardRegistries.chestIds.values()]),
  flagIds: new Set([chapterIndex.rewardRegistries.flagIds.values()]),
};
assert.doesNotThrow(
  () => assertChapterLevelContract(valid, manifest, decks, cocosIteratorReferences),
  'nested Cocos Set/Iterator registries must still allow legal U001 references',
);
assert.doesNotThrow(
  () => assertChapterLevelContract(valid, manifest, decks, cocosIteratorReferences),
  'the same nested Cocos Iterator references must remain valid on a consecutive contract check',
);

expectFailureWithReferences(
  'empty chapter level registry Set',
  valid,
  { ...references, chapterLevelIds: new Set() },
  'config/levels.references.chapterLevelIds',
);
expectFailureWithReferences(
  'empty nested chapter level registry Array',
  valid,
  { ...references, chapterLevelIds: new Set([[]]) },
  'config/levels.references.chapterLevelIds[0]',
);
expectFailureWithReferences(
  'empty nested chapter level registry Iterator',
  valid,
  { ...references, chapterLevelIds: new Set([[][Symbol.iterator]()]) },
  'config/levels.references.chapterLevelIds[0]',
);
const selfReferentialRegistry = new Set();
selfReferentialRegistry.add(selfReferentialRegistry);
expectFailureWithReferences(
  'self-referential chapter level registry',
  valid,
  { ...references, chapterLevelIds: selfReferentialRegistry },
  'config/levels.references.chapterLevelIds[0]',
);
const invalidStepIterator = { next: () => ({ value: 'L01' }) };
expectFailureWithReferences(
  'invalid nested registry Iterator step',
  valid,
  { ...references, chapterLevelIds: new Set([invalidStepIterator]) },
  'config/levels.references.chapterLevelIds[0]',
);
let nonTerminatingIteratorCalls = 0;
const nonTerminatingIterator = {
  next: () => {
    nonTerminatingIteratorCalls += 1;
    if (nonTerminatingIteratorCalls > 1024) throw new Error('non-terminating iterator sentinel');
    return { done: false, value: 'L01' };
  },
};
expectFailureWithReferences(
  'non-terminating registry Iterator',
  valid,
  { ...references, chapterLevelIds: new Set([nonTerminatingIterator]) },
  'config/levels.references.chapterLevelIds[0]',
);
let boundedIteratorCalls = 0;
const boundedIterator = {
  next: () => {
    boundedIteratorCalls += 1;
    return { done: false, value: 'L01' };
  },
};
assert.throws(
  () => assertChapterLevelContract(
    valid,
    manifest,
    decks,
    { ...references, chapterLevelIds: new Set([boundedIterator]) },
  ),
  (error) => {
    assert(error instanceof ConfigLoadError, 'an infinite Iterator must throw ConfigLoadError');
    assert.equal(error.configPath, 'config/levels.references.chapterLevelIds[0]');
    assert.match(error.message, /Iterator 遍历超过安全上限/);
    assert.equal(boundedIteratorCalls, 1024, 'an infinite Iterator must stop at the 1024-step limit');
    return true;
  },
);
const iteratorFailure = new Error('registry iterator exploded');
function* throwingRegistryIterator() {
  throw iteratorFailure;
}
const throwingIteratorReferences = {
  ...references,
  targetIds: new Set([throwingRegistryIterator()]),
};
assert.throws(
  () => assertChapterLevelContract(valid, manifest, decks, throwingIteratorReferences),
  (error) => {
    assert(error instanceof ConfigLoadError, 'a throwing Iterator must throw ConfigLoadError');
    assert.equal(error.configPath, 'config/levels.references.targetIds[0]');
    assert.match(error.message, /Iterator\.next\(\) 失败: registry iterator exploded/);
    assert.equal(error.cause, iteratorFailure, 'the original Iterator failure must remain diagnosable');
    return true;
  },
);
const nestedConfigLoadError = new ConfigLoadError('config/levels.references.inner', 'already normalized');
const existingConfigLoadErrorIterator = {
  next: () => {
    throw nestedConfigLoadError;
  },
};
assert.throws(
  () => assertChapterLevelContract(
    valid,
    manifest,
    decks,
    { ...references, targetIds: new Set([existingConfigLoadErrorIterator]) },
  ),
  (error) => {
    assert.equal(error, nestedConfigLoadError, 'an existing ConfigLoadError must not be wrapped twice');
    return true;
  },
);
const nestedUnitUnknownTarget = structuredClone(valid);
nestedUnitUnknownTarget.chapterLevels[0].objectives[1].targetId = 'U999';
expectFailureWithReferences(
  'nested unit IDs must not authorize unknown U999 target',
  nestedUnitUnknownTarget,
  cocosTranspiledReferences,
  'config/levels.chapterLevels[0].objectives[1].targetId',
);

assert.doesNotThrow(
  () => assertChapterLevelContract(valid, manifest, decks, references),
  'valid chapter level contract must pass',
);
const validSkillReward = structuredClone(valid);
validSkillReward.chapterLevels[0].rewards[0] = { type: 'CARD', id: skillCardId, quantity: 1, cardType: 'SKILL' };
assert.doesNotThrow(
  () => assertChapterLevelContract(validSkillReward, manifest, decks, references),
  'a registered skill card may be a chapter reward',
);
const terminalLevel = structuredClone(valid);
terminalLevel.chapterLevels[0].id = 'L12';
terminalLevel.chapterLevels[0].prerequisiteLevelId = 'L11';
assert.doesNotThrow(
  () => assertChapterLevelContract(terminalLevel, manifest, decks, references),
  'L12 and its chapter-local prerequisite must pass',
);
const waterEnvironment = structuredClone(valid);
waterEnvironment.chapterLevels[0].environmentElement = 'WATER';
assert.doesNotThrow(
  () => assertChapterLevelContract(waterEnvironment, manifest, decks, references),
  'a second legal environment must pass',
);

const enumCoverageById = new Map(enumCoverageFixture.chapterLevels.map((level) => [level.id, level]));
assert.equal(enumCoverageById.get('L05')?.environmentElement, 'FIRE', 'FIRE must be represented by a real chapter fixture');
assert.equal(
  enumCoverageById.get('L10')?.objectives[0]?.type,
  'DESTROY_TARGET',
  'DESTROY_TARGET must be represented by a real chapter fixture',
);
assert.equal(
  enumCoverageById.get('L12')?.failureConditions[0]?.type,
  'ROUND_LIMIT_REACHED',
  'ROUND_LIMIT_REACHED must be represented by a real chapter fixture',
);
assert.equal(
  enumCoverageById.get('L10')?.rewards[0]?.type,
  'UNLOCK',
  'UNLOCK must be represented by a real chapter fixture',
);
assert.equal(
  enumCoverageById.get('L12')?.rewards[0]?.type,
  'CHEST',
  'CHEST must be represented by a real chapter fixture',
);
assert.equal(
  enumCoverageById.get('L12')?.rewards[1]?.type,
  'FLAG',
  'FLAG must be represented by a real chapter fixture',
);
assert.doesNotThrow(
  () => assertChapterLevelContract(enumCoverageFixture, manifest, decks, references),
  'the chapter enum coverage fixture must pass the real contract',
);

function expectFailure(label, mutate, expectedPath) {
  const fixture = structuredClone(valid);
  mutate(fixture);
  assert.throws(() => assertChapterLevelContract(fixture, manifest, decks, references), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

function expectFailureWithReferences(label, fixture, customReferences, expectedPath) {
  assert.throws(() => assertChapterLevelContract(fixture, manifest, decks, customReferences), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

function expectFailureWithReferencesMessage(label, fixture, customReferences, expectedPath, expectedMessage) {
  assert.throws(() => assertChapterLevelContract(fixture, manifest, decks, customReferences), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    assert.match(error.message, expectedMessage, `${label} must preserve the rejection reason`);
    return true;
  });
}

const referencesWithoutL02 = {
  ...references,
  chapterLevelIds: new Set([...references.chapterLevelIds].filter((id) => id !== 'L02')),
};
const unregisteredChapterLevel = structuredClone(valid);
unregisteredChapterLevel.chapterLevels[0].id = 'L02';
expectFailureWithReferences(
  'unregistered chapter level',
  unregisteredChapterLevel,
  referencesWithoutL02,
  'config/levels.chapterLevels[0].id',
);
const referencesWithoutL06 = {
  ...references,
  chapterLevelIds: new Set([...references.chapterLevelIds].filter((id) => id !== 'L06')),
};
const unregisteredPrerequisite = structuredClone(valid);
unregisteredPrerequisite.chapterLevels[0].prerequisiteLevelId = 'L06';
expectFailureWithReferences(
  'unknown registered prerequisite',
  unregisteredPrerequisite,
  referencesWithoutL06,
  'config/levels.chapterLevels[0].prerequisiteLevelId',
);

expectFailure('missing field', (fixture) => { delete fixture.chapterLevels[0].objectives; }, 'config/levels.chapterLevels[0].objectives');
expectFailure('invalid ID', (fixture) => { fixture.chapterLevels[0].id = 'L_01'; }, 'config/levels.chapterLevels[0].id');
expectFailure('out-of-chapter ID', (fixture) => { fixture.chapterLevels[0].id = 'L13'; }, 'config/levels.chapterLevels[0].id');
expectFailure('unknown enemy deck', (fixture) => { fixture.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels.chapterLevels[0].enemyDeckId');
expectFailure('invalid prerequisite', (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'C01'; }, 'config/levels.chapterLevels[0].prerequisiteLevelId');
expectFailure('self prerequisite', (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'L01'; }, 'config/levels.chapterLevels[0].prerequisiteLevelId');
expectFailure('invalid environment', (fixture) => { fixture.chapterLevels[0].environmentElement = 'WIND'; }, 'config/levels.chapterLevels[0].environmentElement');
expectFailure('invalid objective', (fixture) => { fixture.chapterLevels[0].objectives[0].type = 'ESCAPE'; }, 'config/levels.chapterLevels[0].objectives[0].type');
expectFailure('invalid objective target ID', (fixture) => { fixture.chapterLevels[0].objectives[1].targetId = 'U_001'; }, 'config/levels.chapterLevels[0].objectives[1].targetId');
expectFailure('unknown objective target', (fixture) => { fixture.chapterLevels[0].objectives[1].targetId = 'U999'; }, 'config/levels.chapterLevels[0].objectives[1].targetId');
expectFailure('non-positive survival rounds', (fixture) => { fixture.chapterLevels[0].objectives[2].rounds = 0; }, 'config/levels.chapterLevels[0].objectives[2].rounds');
expectFailure('invalid reward ID', (fixture) => { fixture.chapterLevels[0].rewards[0].id = 'U_001'; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('unknown card reward', (fixture) => { fixture.chapterLevels[0].rewards[0].id = 'D001'; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('card reward copy limit', (fixture) => { fixture.chapterLevels[0].rewards[0].quantity = 5; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('reward card type mismatch', (fixture) => { fixture.chapterLevels[0].rewards[0].cardType = 'SKILL'; }, 'config/levels.chapterLevels[0].rewards[0].cardType');
expectFailureWithReferences(
  'missing card metadata',
  valid,
  { ...references, cards: new Map([['U001', { cardType: 'UNIT' }]]) },
  'config/levels.references.cards.U001.copyLimit',
);
expectFailureWithReferences(
  'missing card unit reference',
  valid,
  { ...references, cards: new Map([['U001', { cardType: 'UNIT', copyLimit: 4, unitId: 'U999' }]]) },
  'config/levels.references.cards.U001.unitId',
);
const forgedSkillCardReferences = new Map(references.cards);
forgedSkillCardReferences.set(skillCardId, { cardType: 'SKILL', copyLimit: 1, skillId: 'S999' });
expectFailureWithReferences(
  'missing card skill reference',
  valid,
  { ...references, cards: forgedSkillCardReferences },
  `config/levels.references.cards.${skillCardId}.skillId`,
);
expectFailure('invalid reward type', (fixture) => { fixture.chapterLevels[0].rewards[0].type = 'GOLD'; }, 'config/levels.chapterLevels[0].rewards[0].type');
expectFailure('missing reward quantity', (fixture) => { delete fixture.chapterLevels[0].rewards[0].quantity; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('non-positive reward quantity', (fixture) => { fixture.chapterLevels[0].rewards[0].quantity = 0; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('deck ID cannot be an unlock reward', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'UNLOCK', id: 'D001', quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('unit ID cannot be a chest reward', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'CHEST', id: 'U001', quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('skill ID cannot be a flag reward', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'FLAG', id: skillCardId, quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('reward type registry mismatch', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'UNLOCK', id: 'CHAPTER-CHEST', quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
const cocosDeckReward = structuredClone(valid);
cocosDeckReward.chapterLevels[0].rewards[0] = { type: 'UNLOCK', id: 'D001', quantity: 1 };
expectFailureWithReferencesMessage(
  'Cocos-transpiled forbidden registry must reject D001 unlock reward',
  cocosDeckReward,
  { ...cocosTranspiledReferences, unlockIds: new Set(['D001']) },
  'config/levels.chapterLevels[0].rewards[0].id',
  /不得将牌组、目标或卡牌 ID作为解锁奖励: D001/,
);
const cocosUnitReward = structuredClone(valid);
cocosUnitReward.chapterLevels[0].rewards[0] = { type: 'CHEST', id: 'U001', quantity: 1 };
expectFailureWithReferencesMessage(
  'Cocos-transpiled forbidden registry must reject U001 chest reward',
  cocosUnitReward,
  { ...cocosTranspiledReferences, chestIds: new Set(['U001']) },
  'config/levels.references.chestIds[U001]',
  /不得与 targetIds 重复注册: U001/,
);
const cocosSkillReward = structuredClone(valid);
cocosSkillReward.chapterLevels[0].rewards[0] = { type: 'FLAG', id: 'S001', quantity: 1 };
expectFailureWithReferencesMessage(
  'Cocos-transpiled forbidden registry must reject S001 flag reward',
  cocosSkillReward,
  { ...cocosTranspiledReferences, flagIds: new Set(['S001']) },
  'config/levels.references.flagIds[S001]',
  /不得与 cards 重复注册: S001/,
);
const forgedUnlockReferences = { ...references, unlockIds: new Set(['U001']) };
const forgedUnlockFixture = structuredClone(valid);
forgedUnlockFixture.chapterLevels[0].rewards[0] = { type: 'UNLOCK', id: 'U001', quantity: 1 };
expectFailureWithReferences(
  'unit ID cannot pass by forging the unlock registry',
  forgedUnlockFixture,
  forgedUnlockReferences,
  'config/levels.references.unlockIds[U001]',
);
expectFailureWithReferences(
  'reward registry cannot overlap chapter levels',
  valid,
  { ...references, unlockIds: new Set(['L01']) },
  'config/levels.references.unlockIds[L01]',
);
expectFailure('missing failure condition', (fixture) => { delete fixture.chapterLevels[0].failureConditions; }, 'config/levels.chapterLevels[0].failureConditions');
expectFailure('invalid destroyed target ID', (fixture) => { fixture.chapterLevels[0].failureConditions[1].targetId = 'U_001'; }, 'config/levels.chapterLevels[0].failureConditions[1].targetId');
expectFailure('unknown destroyed target', (fixture) => { fixture.chapterLevels[0].failureConditions[1].targetId = 'U999'; }, 'config/levels.chapterLevels[0].failureConditions[1].targetId');

console.log('Chapter level contract: required real manifest/cards/units/skills/decks references, chapter prerequisites, target/reward registries, card type/copy limits, enum coverage and negative cases PASS');
