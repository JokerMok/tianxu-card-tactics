import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAPTER01_ID,
  CHAPTER01_INDEX_CONFIG_REF,
  CHAPTER01_LEVEL_IDS,
  CHAPTER01_STORY_NODE_IDS,
  CHAPTER01_STORY_NODES,
  Chapter01StoryError,
  Chapter01StoryService,
  createChapter01Story,
  restoreChapter01Story,
} from '../assets/scripts/meta/story/Chapter01Story.ts';
import * as storyIndex from '../assets/scripts/meta/story/index.ts';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const resourceRoot = path.join(projectRoot, 'assets', 'resources');
const configRoot = path.join(resourceRoot, 'config');
const storyIndexSource = fs.readFileSync(
  path.join(projectRoot, 'assets', 'scripts', 'meta', 'story', 'index.ts'),
  'utf8',
);
const storyExportBlock = storyIndexSource.match(
  /export\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/Chapter01Story\.ts['"]/u,
);
assert(storyExportBlock, 'story/index.ts 必须从 Chapter01Story.ts 重导出');
assert.match(storyExportBlock[1], /\btype\s+StoryPersistence\b/u, 'story/index.ts 必须导出真实存在的 StoryPersistence');
assert.equal(
  (storyExportBlock[1].match(/\btype\s+StoryPersistence\b/gu) ?? []).length,
  1,
  'story/index.ts 只能导出一次 StoryPersistence',
);
assert.doesNotMatch(storyExportBlock[1], /\bChapter01StoryPersistence\b/u, 'story/index.ts 不得导出不存在的 Chapter01StoryPersistence');
assert.equal(storyIndex.createChapter01Story, createChapter01Story, 'story/index.ts 运行时导入必须指向真实实现');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expectStoryError(action, code) {
  assert.throws(action, (error) => error instanceof Chapter01StoryError && error.code === code);
}

const chapterIndex = readJson(path.join(configRoot, 'levels', 'chapter01', 'index.json'));
assert.equal(CHAPTER01_ID, 'CHAPTER01');
assert.equal(CHAPTER01_INDEX_CONFIG_REF, 'config/levels/chapter01/index');
assert.deepEqual(chapterIndex.levels.map(({ id }) => id), [...CHAPTER01_LEVEL_IDS]);

const expectedNames = [
  '押册出垣', '烽台失名', '风谷截路', '双线交锋', '烬犬追迹', '寒铭封路',
  '崩岩阵地', '空册开封', '旧军返阵', '夺回末烽', '神门点册', '玄枢归序',
];
assert.deepEqual(
  CHAPTER01_STORY_NODES.filter(({ kind }) => kind === 'PRE_BATTLE').map(({ title }) => title.replace(/^1-\d+ /u, '').replace('·战前', '')),
  expectedNames,
  '战前节点必须对应首章真实关卡名称',
);
assert.equal(CHAPTER01_STORY_NODES[0].kind, 'OPENING');
assert.equal(CHAPTER01_STORY_NODES[0].levelId, null);
assert.equal(CHAPTER01_STORY_NODES[0].levelConfigRef, CHAPTER01_INDEX_CONFIG_REF);
assert.equal(CHAPTER01_STORY_NODES.length, 26, '开场 + 12 战前 + 12 战后 + 1 Boss');
assert.deepEqual(
  CHAPTER01_STORY_NODE_IDS,
  CHAPTER01_STORY_NODES.map(({ id }) => id),
  '节点 ID 表必须稳定且无重复',
);
assert.equal(new Set(CHAPTER01_STORY_NODE_IDS).size, CHAPTER01_STORY_NODE_IDS.length);
assert(CHAPTER01_STORY_NODES.every(({ skippable }) => skippable === true));

for (const levelId of CHAPTER01_LEVEL_IDS) {
  const configRef = `config/levels/chapter01/${levelId}`;
  const levelConfig = readJson(path.join(resourceRoot, `${configRef}.json`));
  assert.equal(levelConfig.chapterLevels[0].id, levelId, `${levelId} 必须读取真实关卡配置`);
  const levelNodes = CHAPTER01_STORY_NODES.filter((node) => node.levelId === levelId);
  assert.deepEqual(
    levelNodes.map(({ kind }) => kind),
    levelId === 'L12' ? ['PRE_BATTLE', 'BOSS', 'POST_BATTLE'] : ['PRE_BATTLE', 'POST_BATTLE'],
    `${levelId} 节点顺序必须是战前、战后；L12 插入 Boss`,
  );
  assert(levelNodes.every(({ levelConfigRef }) => levelConfigRef === configRef));
}

const initial = createChapter01Story();
assert.equal(initial.currentNode().id, 'CH01-OPENING');
assert.equal(initial.snapshot().readNodeIds.length, 0);

const persisted = [];
const service = createChapter01Story({ persist: (serialized) => persisted.push(serialized) });
const openingSave = service.serialize();
assert.equal(openingSave, '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":[]}');
assert.equal(service.skip('CH01-OPENING'), true);
assert.equal(persisted.length, 1);
assert.equal(persisted[0], service.serialize());
assert.equal(service.currentNode().id, 'CH01-L01-PRE');
assert.deepEqual(service.snapshot().readNodeIds, ['CH01-OPENING']);

const repeatedBefore = service.serialize();
const persistedBeforeRepeat = persisted.length;
assert.equal(service.skip('CH01-OPENING'), false, '重复 skip 必须幂等且不重新持久化');
assert.equal(service.serialize(), repeatedBefore);
assert.equal(persisted.length, persistedBeforeRepeat);

const outOfOrderBefore = service.serialize();
expectStoryError(() => service.skip('CH01-L01-POST'), 'OUT_OF_ORDER');
assert.equal(service.serialize(), outOfOrderBefore, '越序 skip 不得改变进度');
assert.equal(service.skipCurrent(), true);
assert.equal(service.currentNode().id, 'CH01-L01-POST');

const restored = restoreChapter01Story(service.serialize());
assert.deepEqual(restored.snapshot(), service.snapshot(), '有效存档必须恢复到同一节点');
assert.equal(restored.skipCurrent(), true);
assert.equal(restored.currentNode().id, 'CH01-L02-PRE');

const deterministicA = createChapter01Story();
const deterministicB = createChapter01Story();
for (const nodeId of ['CH01-OPENING', 'CH01-L01-PRE', 'CH01-L01-POST', 'CH01-L02-PRE']) {
  assert.equal(deterministicA.skip(nodeId), true);
  assert.equal(deterministicB.skip(nodeId), true);
  assert.equal(deterministicA.serialize(), deterministicB.serialize(), '相同输入必须生成相同存档');
}
assert.equal(deterministicA.save(), deterministicA.serialize(), '重复序列化必须稳定');

const corruptTarget = createChapter01Story();
corruptTarget.skip('CH01-OPENING');
const safeBeforeCorruption = corruptTarget.serialize();
const corruptSaves = [
  ['非 JSON', '{', 'INVALID_SAVE'],
  ['根值 null', 'null', 'INVALID_SAVE'],
  ['根值数组', '[]', 'INVALID_SAVE'],
  ['schema 缺失', '{"chapterId":"CHAPTER01","readNodeIds":[]}', 'INVALID_SAVE'],
  ['schema 版本错误', '{"schemaVersion":2,"chapterId":"CHAPTER01","readNodeIds":[]}', 'SAVE_VERSION'],
  ['章节错误', '{"schemaVersion":1,"chapterId":"CHAPTER02","readNodeIds":[]}', 'INVALID_SAVE'],
  ['未知字段', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":[],"extra":1}', 'INVALID_SAVE'],
  ['readNodeIds 类型错误', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":null}', 'INVALID_SAVE'],
  ['节点未知', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":["CH01-NOPE"]}', 'INVALID_SAVE'],
  ['节点重复', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":["CH01-OPENING","CH01-OPENING"]}', 'INVALID_SAVE'],
  ['节点越序', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":["CH01-OPENING","CH01-L01-POST"]}', 'INVALID_SAVE'],
  ['节点缺少前缀', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":["CH01-L01-PRE"]}', 'INVALID_SAVE'],
  ['节点值非字符串', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":[1]}', 'INVALID_SAVE'],
  ['节点对象', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":[{}]}', 'INVALID_SAVE'],
  ['同节点非法空格', '{"schemaVersion":1,"chapterId":"CHAPTER01","readNodeIds":["CH01-OPENING "]}', 'INVALID_SAVE'],
];
for (const [label, serialized, code] of corruptSaves) {
  expectStoryError(() => corruptTarget.restore(serialized), code);
  assert.equal(corruptTarget.serialize(), safeBeforeCorruption, `${label}不得污染内存进度`);
}
assert.equal(corruptSaves.length, 15, '至少覆盖 12 个损坏存档反例');

const invalidNodeTarget = createChapter01Story();
const invalidNodeBefore = invalidNodeTarget.serialize();
for (const invalidNode of [null, '', 'CH01-NOPE', {}, 1]) {
  expectStoryError(() => invalidNodeTarget.skip(invalidNode), 'INVALID_NODE');
  assert.equal(invalidNodeTarget.serialize(), invalidNodeBefore, '非法节点不得污染内存进度');
}

let persistAttempts = 0;
const persistenceFailure = createChapter01Story({
  persist: () => {
    persistAttempts += 1;
    throw new Error('disk unavailable');
  },
});
expectStoryError(() => persistenceFailure.skip('CH01-OPENING'), 'PERSISTENCE_FAILED');
assert.equal(persistAttempts, 1);
assert.equal(persistenceFailure.serialize(), openingSave, '持久化失败时不得提交内存进度');

const completed = createChapter01Story();
while (completed.currentNode() !== null) completed.skipCurrent();
assert.equal(completed.snapshot().currentNodeId, null);
assert.equal(completed.snapshot().readNodeIds.length, CHAPTER01_STORY_NODES.length);
const completedSave = completed.serialize();
assert.deepEqual(Chapter01StoryService.fromSerialized(completedSave).snapshot(), completed.snapshot());
assert.equal(completed.skipCurrent(), false, '全部读完后的重复 skip 必须保持不变');

console.log(`Chapter 01 story: opening/pre-battle/post-battle/Boss, real L01-L12 config refs, ordered skip persistence, deterministic saves PASS; ${corruptSaves.length + 5} negative cases PASS`);
