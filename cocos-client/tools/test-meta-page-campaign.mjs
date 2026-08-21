import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CAMPAIGN_DEFAULT_DATA,
  CampaignPageError,
  CampaignPageService,
  createDefaultCampaignPageData,
  createEmptyCampaignPageData,
  createCampaignPageComponents,
} from '../assets/scripts/meta/ui/pages/home-campaign-cards/campaign/index.ts';
import { CampaignStateError } from '../assets/scripts/meta/campaign/CampaignState.ts';

const root = path.resolve(import.meta.dirname, '..');
const campaignRoot = path.join(root, 'assets/scripts/meta/ui/pages/home-campaign-cards/campaign');
const targetFiles = ['CampaignContracts.ts', 'CampaignComponents.ts', 'CampaignPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(campaignRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > 300, `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI02|loadSprite|整图/, `${file} must not depend on page artwork text or numbers`);
}
assert.match(targetSource.get('CampaignComponents.ts'), /createCampaignPageComponents/);
assert.match(targetSource.get('CampaignPageService.ts'), /STATE_DATA_MISMATCH/);
assert.match(targetSource.get('CampaignPageService.ts'), /CampaignStateService/);

const configRoot = path.join(root, 'assets/resources/config/levels/chapter01');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const index = readJson(path.join(configRoot, 'index.json'));
const levelConfigs = index.levels.map(({ id }) => {
  const document = readJson(path.join(configRoot, `${id}.json`));
  assert.equal(document.chapterLevels.length, 1, `${id} must contain one real level config`);
  assert.equal(document.chapterLevels[0].id, id, `${id} config must match the real index`);
  return document.chapterLevels[0];
});

const defaultData = createDefaultCampaignPageData();
assert.deepEqual(defaultData.levels.map(({ id }) => id), index.levels.map(({ id }) => id), 'page data must cover the real chapter index');
assert.equal(defaultData.levels.length, 12, 'the real chapter has twelve page nodes');
assert.equal(defaultData.levels[0].objective, levelConfigs[0].objectives[0].type, 'page objective must be data-driven');
assert.deepEqual(CAMPAIGN_DEFAULT_DATA.levels[11].id, index.levels[11].id, 'default data must retain the final real level');
assert.equal(createCampaignPageComponents(defaultData).find((component) => component.id === 'detail')?.canStart, true, 'pure component projection must expose the initial playable node');
assert.equal(createCampaignPageComponents(defaultData).find((component) => component.id === 'level-L01')?.selected, true, 'pure component projection must select the initial node');

let negativeCaseCount = 0;
function expectStateFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CampaignStateError, `${label} must throw CampaignStateError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

function expectPageFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CampaignPageError, `${label} must throw CampaignPageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

const saves = [];
const page = new CampaignPageService({
  data: defaultData,
  config: index,
  persist: (serialized) => saves.push(serialized),
});
const initial = page.snapshot();
assert.equal(initial.pageId, 'campaign');
assert.equal(initial.selectedLevelId, 'L01');
assert.equal(initial.activeLevelId, null);
assert.deepEqual(initial.components.map((component) => component.id), [
  'header', ...index.levels.map(({ id }) => `level-${id}`), 'detail',
]);
assert.equal(initial.components.find((component) => component.id === 'header')?.totalLevels, 12);
assert.equal(initial.components.find((component) => component.id === 'level-L01')?.state, 'selected');
assert.equal(initial.components.find((component) => component.id === 'level-L02')?.state, 'locked');
assert.equal(initial.components.find((component) => component.id === 'detail')?.title, defaultData.levels[0].title);
assert.equal(initial.components.find((component) => component.id === 'detail')?.canStart, true);

// Selecting the already selected node is a real idempotent no-op and must not save.
const savesBeforeSameSelection = saves.length;
assert.deepEqual(page.selectLevel('L01'), { accepted: true, changed: false, reason: 'same', levelId: 'L01' });
assert.equal(saves.length, savesBeforeSameSelection, 'same selection must not persist a duplicate save');
assert.deepEqual(page.interact({ type: 'selectLevel', levelId: 'L01' }), {
  accepted: true, changed: false, reason: 'same', levelId: 'L01',
});

// The state machine, not the page renderer, owns unlock and attempt rules.
expectStateFailure('locked level selection', () => page.selectLevel('L02'), 'LEVEL_LOCKED');
assert.deepEqual(page.startLevel(), { accepted: true, changed: true, reason: 'started', levelId: 'L01' });
assert.equal(page.snapshot().components.find((component) => component.id === 'level-L01')?.state, 'inProgress');
assert.equal(page.snapshot().components.find((component) => component.id === 'detail')?.canStart, false);
expectStateFailure('starting an active level twice', () => page.startLevel(), 'REENTRANT');
const afterStart = page.snapshot().state;
assert.equal(afterStart?.activeLevelId, 'L01');

assert.deepEqual(page.completeLevel('L01', 3), {
  accepted: true, changed: true, reason: 'completed', levelId: 'L01',
});
assert.equal(page.snapshot().state?.levels.L01.firstClear, true);
assert.equal(page.snapshot().state?.levels.L01.stars, 3);
assert.equal(page.snapshot().state?.levels.L02.unlocked, true, 'first clear must unlock the configured next node');
assert.equal(page.snapshot().components.find((component) => component.id === 'level-L02')?.state, 'ready');

// A failed first attempt remains visible and does not unlock the following node.
page.selectLevel('L02');
page.startLevel();
assert.deepEqual(page.failLevel(), { accepted: true, changed: true, reason: 'failed', levelId: 'L02' });
assert.equal(page.snapshot().components.find((component) => component.id === 'level-L02')?.state, 'failed');
assert.equal(page.snapshot().state?.levels.L03.unlocked, false);
page.startLevel('L02');
page.completeLevel(1);
assert.equal(page.snapshot().state?.levels.L02.firstClear, true);
assert.equal(page.snapshot().state?.levels.L03.unlocked, true);

// Replay is legal, retains the best stars and remains isolated to the selected node.
page.selectLevel('L01');
page.startLevel();
assert.equal(page.snapshot().state?.levels.L01.replayCount, 1);
page.completeLevel(2);
assert.equal(page.snapshot().state?.levels.L01.stars, 3, 'replay must not lower the best stars');
assert.equal(page.snapshot().state?.levels.L02.stars, 1, 'replay must not alter another level');

// Save/restore is deterministic, detached and includes the current component state.
const serialized = page.serialize();
assert.equal(page.save(), serialized);
assert.equal(saves.at(-1), serialized);
const restored = new CampaignPageService({ data: defaultData, config: index, initialState: serialized });
assert.deepEqual(restored.snapshot().state, page.snapshot().state);
assert.equal(restored.serialize(), serialized);
const restoredAgain = restored.restore(serialized);
assert.deepEqual(restoredAgain.state, page.snapshot().state, 'restoring the same save must be idempotent');
const detachedData = restored.pageData;
detachedData.levels[0].rewards[0].quantity = 999;
assert.notEqual(restored.pageData.levels[0].rewards[0].quantity, 999, 'page data must be detached from callers');

// Persistence failure is atomic at the page boundary because the real state service rolls back before commit.
const failing = new CampaignPageService({
  data: defaultData,
  config: index,
  persist: () => { throw new Error('disk full'); },
});
const beforePersistenceFailure = failing.snapshot();
expectStateFailure('persistence failure', () => failing.startLevel(), 'PERSISTENCE_FAILED');
assert.deepEqual(failing.snapshot(), beforePersistenceFailure, 'failed persistence must not change page state');

// Configured display data must flow through every component without relying on artwork literals.
const configuredData = {
  ...defaultData,
  title: '测试征战页',
  subtitle: '测试章节',
  levels: [
    {
      ...defaultData.levels[0],
      title: '雾岭关',
      description: '测试关卡说明',
      recommendedPower: 777,
      rewards: [{ id: 'TEST', label: '测试奖励', quantity: 2 }],
    },
  ],
};
const configured = new CampaignPageService({ data: configuredData, config: index });
assert.equal(configured.snapshot().components.find((component) => component.id === 'header')?.title, '测试征战页');
assert.equal(configured.snapshot().components.find((component) => component.id === 'level-L01')?.title, '雾岭关');
assert.equal(configured.snapshot().components.find((component) => component.id === 'detail')?.recommendedPower, 777);
assert.equal(configured.snapshot().components.find((component) => component.id === 'detail')?.rewards[0].quantity, 2);
const levelConfigOnly = new CampaignPageService({ data: defaultData, levelConfigs });
assert.equal(levelConfigOnly.snapshot().state?.levels.L01.unlocked, true, 'levelConfigs alias must use the existing state configuration contract');

// Empty state has no hidden fake node and no accidental persistence backing.
const empty = new CampaignPageService(createEmptyCampaignPageData());
assert.deepEqual(empty.snapshot().components.map((component) => component.id), ['campaign-empty']);
assert.equal(empty.snapshot().state, null);
assert.deepEqual(empty.selectLevel('L01'), { accepted: false, changed: false, reason: 'empty', levelId: null });
assert.deepEqual(empty.startLevel(), { accepted: false, changed: false, reason: 'empty', levelId: null });
expectPageFailure('empty page serialize', () => empty.serialize(), 'STATE_NOT_AVAILABLE');
expectPageFailure('empty page with state config', () => new CampaignPageService({
  data: createEmptyCampaignPageData(), config: index,
}), 'STATE_DATA_MISMATCH');

// Missing, duplicate, malformed and illegal interactions are rejected by real checks.
const missingLevels = { ...defaultData };
delete missingLevels.levels;
expectPageFailure('missing levels field', () => new CampaignPageService(missingLevels), 'MISSING_FIELD');
expectPageFailure('duplicate level id', () => new CampaignPageService({
  ...defaultData,
  levels: [defaultData.levels[0], { ...defaultData.levels[0] }],
}), 'DUPLICATE_ID');
expectPageFailure('invalid reward quantity', () => new CampaignPageService({
  ...defaultData,
  levels: [{ ...defaultData.levels[0], rewards: [{ ...defaultData.levels[0].rewards[0], quantity: 0 }] }],
}), 'INVALID_DATA');
expectPageFailure('null page data', () => new CampaignPageService({ data: null }), 'INVALID_ARGUMENT');
expectStateFailure('unknown level id', () => configured.selectLevel('L99'), 'INVALID_LEVEL_ID');
expectStateFailure('unknown interaction level id', () => configured.interact({ type: 'selectLevel', levelId: 'L99' }), 'INVALID_LEVEL_ID');
expectPageFailure('unknown interaction type', () => configured.interact({ type: 'unknown' }), 'INVALID_ARGUMENT');
expectStateFailure('invalid stars without an active level', () => configured.completeLevel(0), 'NO_ACTIVE_LEVEL');
expectStateFailure('missing level id settlement', () => configured.completeLevel(undefined, 1), 'NO_ACTIVE_LEVEL');

const illegal = new CampaignPageService({ data: defaultData, config: index });
expectStateFailure('locked level start', () => illegal.startLevel('L12'), 'LEVEL_LOCKED');
illegal.startLevel('L01');
expectStateFailure('fractional stars', () => illegal.completeLevel(1.5), 'INVALID_STARS');
const activeBeforeInvalidSettlement = illegal.snapshot();
assert.deepEqual(illegal.snapshot(), activeBeforeInvalidSettlement, 'invalid settlement must preserve active state');
illegal.failLevel();
expectStateFailure('settle without active level', () => illegal.completeLevel(1), 'NO_ACTIVE_LEVEL');

assert.equal(negativeCaseCount, 17, 'all missing, malformed, locked, failed and boundary cases must execute');
console.log(`T307 campaign page PASS: components=${initial.components.length}, empty-components=${empty.snapshot().components.length}, saves=${saves.length}, negative-cases=${negativeCaseCount}, real-levels=${levelConfigs.length}, save-restore-idempotent=true`);
