import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
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

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/manifest.json'), 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const units = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/units.json'), 'utf8'));
const skills = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/skills.json'), 'utf8'));
const decks = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/decks.json'), 'utf8'));
const enumCoverageFixture = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'), 'utf8'),
);

// 来源：当前生效《首章剧情关卡-v1.1.md》§3.1/§7；只注册本测试实际覆盖的章节节点及其文档前置。
const chapterLevelIds = new Set([
  'L01',
  ...enumCoverageFixture.chapterLevels.map((level) => level.id),
  ...enumCoverageFixture.chapterLevels
    .map((level) => level.prerequisiteLevelId)
    .filter((id) => id !== null),
]);
// 来源：真实 units.json；章节目标使用战场单位 ID，避免用卡牌、牌组或技能 ID冒充目标。
const targetIds = new Set(units.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id));
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
// 来源：当前生效章节奖励注册表（《首章剧情关卡-v1.1.md》§7）及 T331 enum fixture 的稳定 ID 映射。
const references = {
  chapterLevelIds,
  targetIds,
  unitIds,
  skillIds,
  cards: cardReferences,
  unlockIds: new Set(['OUTPOST']),
  chestIds: new Set(['CHAPTER-CHEST']),
  flagIds: new Set(['OUTCAST-CAMP']),
};
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

expectFailure('missing field', (fixture) => { delete fixture.chapterLevels[0].objectives; }, 'config/levels.chapterLevels[0].objectives');
expectFailure('invalid ID', (fixture) => { fixture.chapterLevels[0].id = 'L_01'; }, 'config/levels.chapterLevels[0].id');
expectFailure('out-of-chapter ID', (fixture) => { fixture.chapterLevels[0].id = 'L13'; }, 'config/levels.chapterLevels[0].id');
expectFailure('unregistered chapter level', (fixture) => { fixture.chapterLevels[0].id = 'L02'; }, 'config/levels.chapterLevels[0].id');
expectFailure('unknown enemy deck', (fixture) => { fixture.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels.chapterLevels[0].enemyDeckId');
expectFailure('invalid prerequisite', (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'C01'; }, 'config/levels.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown registered prerequisite', (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'L06'; }, 'config/levels.chapterLevels[0].prerequisiteLevelId');
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
expectFailure('invalid reward type', (fixture) => { fixture.chapterLevels[0].rewards[0].type = 'GOLD'; }, 'config/levels.chapterLevels[0].rewards[0].type');
expectFailure('missing reward quantity', (fixture) => { delete fixture.chapterLevels[0].rewards[0].quantity; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('non-positive reward quantity', (fixture) => { fixture.chapterLevels[0].rewards[0].quantity = 0; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('deck ID cannot be an unlock reward', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'UNLOCK', id: 'D001', quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('unit ID cannot be a chest reward', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'CHEST', id: 'U001', quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('skill ID cannot be a flag reward', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'FLAG', id: skillCardId, quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('reward type registry mismatch', (fixture) => { fixture.chapterLevels[0].rewards[0] = { type: 'UNLOCK', id: 'CHAPTER-CHEST', quantity: 1 }; }, 'config/levels.chapterLevels[0].rewards[0].id');
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
