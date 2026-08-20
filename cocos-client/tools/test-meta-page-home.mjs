import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HomePageError,
  HomePageService,
  createDefaultHomePageData,
  createEmptyHomePageData,
} from '../assets/scripts/meta/ui/pages/home-campaign-cards/home/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const homeRoot = path.join(root, 'assets/scripts/meta/ui/pages/home-campaign-cards/home');
const targetFiles = ['HomeContracts.ts', 'HomeComponents.ts', 'HomePageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(homeRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > 300, `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI01|loadSprite|整图/, `${file} must not depend on page artwork text or numbers`);
}
assert.match(targetSource.get('HomeComponents.ts'), /createHomePageComponents/);
assert.match(targetSource.get('HomePageService.ts'), /INDEX_OUT_OF_RANGE/);
assert.match(targetSource.get('HomePageService.ts'), /GOAL_NOT_FOUND/);

let negativeCaseCount = 0;
function expectFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof HomePageError, `${label} must throw HomePageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

const defaultData = createDefaultHomePageData();
const service = new HomePageService(defaultData);
const normal = service.snapshot();
const hero = normal.components.find((component) => component.id === 'hero');
const mission = normal.components.find((component) => component.id === 'mission');
const deck = normal.components.find((component) => component.id === 'quick-deck');
const stageGoal = normal.components.find((component) => component.id === 'goal-stage');

assert.equal(normal.pageId, 'home');
assert.equal(hero?.kind, 'hero');
assert.equal(hero?.title, defaultData.player.name, 'hero must use configured player data');
assert.equal(hero?.subtitle, defaultData.player.profession, 'hero must use configured profession data');
assert.equal(hero?.value, `Lv.${defaultData.player.level}`, 'hero level must be data-driven');
assert.equal(mission?.kind, 'mission');
assert.equal(mission?.stage, defaultData.mission?.stage, 'mission stage must use configured data');
assert.equal(deck?.value, defaultData.quickActions[0].value, 'quick action value must use configured data');
assert.equal(stageGoal?.progress, defaultData.goals[0].progress, 'goal progress must use configured data');
assert.deepEqual(normal.components.map((component) => component.id), [
  'hero', 'mission', 'quick-deck', 'quick-tower', 'quick-city', 'goal-stage', 'goal-upgrade',
]);

const configuredData = {
  ...defaultData,
  player: { name: '测试主将', profession: '巡守', level: 12 },
  mission: {
    chapter: '第二章', stage: '2-9', title: '雾岭关', description: '测试关卡说明', actionLabel: '前往关卡',
  },
  quickActions: [{ id: 'deck', title: '临时编队', value: '2/5 张', target: 'deck', enabled: true }],
  goals: [{ id: 'stage', label: '完成 2 次', progress: 2, target: 2 }],
};
const configured = new HomePageService(configuredData).snapshot();
assert.equal(configured.components.find((component) => component.id === 'hero')?.title, '测试主将');
assert.equal(configured.components.find((component) => component.id === 'mission')?.title, '雾岭关');
assert.equal(configured.components.find((component) => component.id === 'quick-deck')?.value, '2/5 张');
assert.equal(configured.components.find((component) => component.id === 'goal-stage')?.state, 'complete');

assert.deepEqual(service.activateMission(), { accepted: true, changed: true, reason: 'navigated', target: 'campaign' });
assert.deepEqual(service.activateMission(), { accepted: true, changed: false, reason: 'same', target: 'campaign' });
assert.deepEqual(service.activateQuickAction(0), { accepted: true, changed: true, reason: 'navigated', target: 'deck' });
assert.equal(service.snapshot().selectedComponentId, 'quick-deck');
assert.deepEqual(service.claimGoal('stage'), { accepted: false, changed: false, reason: 'not-ready', target: null });

const disabled = new HomePageService({
  ...defaultData,
  quickActions: defaultData.quickActions.map((action, index) => index === 1 ? { ...action, enabled: false } : { ...action }),
});
assert.equal(disabled.snapshot().components.find((component) => component.id === 'quick-tower')?.state, 'disabled');
assert.deepEqual(disabled.activateQuickAction(1), { accepted: false, changed: false, reason: 'disabled', target: null });

const claimable = new HomePageService(configuredData);
assert.deepEqual(claimable.claimGoal('stage'), { accepted: true, changed: true, reason: 'claimed', target: null });
assert.equal(claimable.snapshot().components.find((component) => component.id === 'goal-stage')?.state, 'claimed');
assert.deepEqual(claimable.claimGoal('stage'), { accepted: false, changed: false, reason: 'claimed', target: null });

const empty = new HomePageService(createEmptyHomePageData());
const emptySnapshot = empty.snapshot();
assert.deepEqual(emptySnapshot.components.map((component) => component.id), [
  'hero', 'mission-empty', 'quick-actions-empty', 'goals-empty',
]);
assert(emptySnapshot.components.every((component) => component.kind === 'hero' || component.state === 'empty'));
assert.deepEqual(empty.activateMission(), { accepted: false, changed: false, reason: 'empty', target: null });

const missingMission = { ...defaultData };
delete missingMission.mission;
expectFailure('missing mission field', () => new HomePageService(missingMission), 'MISSING_FIELD');
expectFailure('invalid player level', () => new HomePageService({
  ...defaultData,
  player: { ...defaultData.player, level: 0 },
}), 'INVALID_DATA');
expectFailure('out-of-range quick action index', () => service.activateQuickAction(99), 'INDEX_OUT_OF_RANGE');
expectFailure('fractional quick action index', () => service.activateQuickAction(0.5), 'INVALID_NUMBER');
expectFailure('unknown goal id', () => service.claimGoal('missing-goal'), 'GOAL_NOT_FOUND');
expectFailure('empty goal id', () => service.claimGoal(''), 'INVALID_DATA');
expectFailure('invalid empty interaction', () => empty.interact({ type: 'activateQuickAction', index: 0 }), 'INDEX_OUT_OF_RANGE');
expectFailure('unknown interaction type', () => empty.interact({ type: 'unknown' }), 'INVALID_ARGUMENT');
expectFailure('invalid quick action target', () => new HomePageService({
  ...defaultData,
  quickActions: [{ ...defaultData.quickActions[0], target: 'unknown' }],
}), 'INVALID_DATA');

assert.equal(negativeCaseCount, 9, 'all missing, invalid, illegal and out-of-range cases must execute');
console.log(`T306 home page PASS: components=${normal.components.length}, empty-components=${emptySnapshot.components.length}, negative-cases=${negativeCaseCount}, real-source-files=${targetSource.size}`);
