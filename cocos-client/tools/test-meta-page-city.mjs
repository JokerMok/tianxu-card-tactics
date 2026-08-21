import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CITY_BUILDING_IDS,
  CITY_PAGE_SCHEMA_VERSION,
  CityPageError,
  CityPageService,
  createDefaultCityPageData,
  createEmptyCityPageData,
} from '../assets/scripts/meta/ui/pages/city-tasks-inventory/city/index.ts';
import { createDefaultState } from '../assets/scripts/meta/GameState.ts';

const root = path.resolve(import.meta.dirname, '..');
const cityRoot = path.join(root, 'assets/scripts/meta/ui/pages/city-tasks-inventory/city');
const targetFiles = ['CityContracts.ts', 'CityComponents.ts', 'CityPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(cityRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > 300, `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI07|loadSprite|整图/, `${file} must not depend on page artwork text or numbers`);
}
assert.match(targetSource.get('CityComponents.ts'), /createCityPageComponents/);
assert.match(targetSource.get('CityPageService.ts'), /INDEX_OUT_OF_RANGE/);
assert.match(targetSource.get('CityPageService.ts'), /upgradeBuilding/);

const realState = createDefaultState();
const realData = createDefaultCityPageData(realState);
assert.equal(realData.schemaVersion, CITY_PAGE_SCHEMA_VERSION);
assert.deepEqual(realData.buildings.map(({ id }) => id), [...CITY_BUILDING_IDS], 'city ids must come from the real game-state building authority');
assert.deepEqual(realData.buildings.map(({ level }) => level), [3, 2, 2, 1], 'default city levels must use GameState seed');
assert.deepEqual(realData.resources, { silver: 12800, crystal: 460, stamina: 82, staminaMax: 100 });
assert.equal(realData.expedition?.rewardSilver, 1600, 'expedition reward must use the real GameState rule');

const page = new CityPageService(realData);
const normal = page.snapshot();
assert.equal(normal.pageId, 'city');
assert.deepEqual(normal.components.map((component) => component.id), [
  'header', 'building-castle', 'building-alchemy', 'building-forge', 'building-harbor', 'expedition',
]);
const header = normal.components.find((component) => component.id === 'header');
const castle = normal.components.find((component) => component.id === 'building-castle');
const alchemy = normal.components.find((component) => component.id === 'building-alchemy');
const expedition = normal.components.find((component) => component.id === 'expedition');
assert.equal(header?.silver, realState.resources.silver, 'header resources must be data-driven');
assert.equal(castle?.level, realState.buildings.castle, 'castle level must be data-driven');
assert.equal(alchemy?.upgradeCost.silver, realState.buildings.alchemy * 1400, 'upgrade cost must use the real GameState rule');
assert.equal(expedition?.state, 'idle');
assert.equal(expedition?.canDispatch, true);

const configured = new CityPageService({
  ...realData,
  title: '测试营造',
  resources: { silver: 10000, crystal: 100, stamina: 5, staminaMax: 5 },
  buildings: realData.buildings.map((building) => building.id === 'forge' ? { ...building, level: 3, maxLevel: 3 } : { ...building }),
});
assert.equal(configured.snapshot().components.find((component) => component.id === 'header')?.title, '测试营造');
assert.equal(configured.snapshot().components.find((component) => component.id === 'building-forge')?.state, 'maxed');
assert.equal(configured.snapshot().components.find((component) => component.id === 'expedition')?.canDispatch, false);

assert.deepEqual(page.selectBuilding('forge'), { accepted: true, changed: true, reason: 'selected', buildingId: 'forge' });
assert.deepEqual(page.selectBuilding('forge'), { accepted: true, changed: false, reason: 'same', buildingId: 'forge' });
assert.deepEqual(page.upgradeBuilding('forge'), { accepted: true, changed: true, reason: 'upgraded', buildingId: 'forge' });
assert.equal(page.snapshot(1000).components.find((component) => component.id === 'building-forge')?.level, 3);
assert.deepEqual(page.dispatchExpedition(1000), { accepted: true, changed: true, reason: 'dispatched', buildingId: null });
assert.equal(page.snapshot(1000).components.find((component) => component.id === 'expedition')?.state, 'active');
assert.deepEqual(page.claimExpedition(1000 + realData.expedition.durationMs - 1), { accepted: false, changed: false, reason: 'active', buildingId: null });
assert.deepEqual(page.claimExpedition(1000 + realData.expedition.durationMs), { accepted: true, changed: true, reason: 'claimed', buildingId: null });
assert.equal(page.snapshot(1000 + realData.expedition.durationMs).components.find((component) => component.id === 'expedition')?.state, 'idle');

let negativeCaseCount = 0;
function expectFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CityPageError, `${label} must throw CityPageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

const empty = new CityPageService(createEmptyCityPageData());
assert.deepEqual(empty.snapshot().components.map((component) => component.id), ['city-empty']);
assert.deepEqual(empty.selectBuildingAt(0), { accepted: false, changed: false, reason: 'empty', buildingId: null });
assert.deepEqual(empty.upgradeBuilding('castle'), { accepted: false, changed: false, reason: 'empty', buildingId: null });
assert.deepEqual(empty.dispatchExpedition(0), { accepted: false, changed: false, reason: 'empty', buildingId: null });

const missingResources = { ...realData };
delete missingResources.resources;
expectFailure('missing resources field', () => new CityPageService(missingResources), 'MISSING_FIELD');
expectFailure('invalid building id', () => page.selectBuilding('unknown'), 'INVALID_ID');
expectFailure('out-of-range building index', () => page.selectBuildingAt(99), 'INDEX_OUT_OF_RANGE');
expectFailure('fractional building index', () => page.selectBuildingAt(0.5), 'INVALID_NUMBER');
expectFailure('unknown interaction type', () => page.interact({ type: 'unknown' }), 'INVALID_ARGUMENT');
expectFailure('negative expedition time', () => page.dispatchExpedition(-1), 'INVALID_DATA');
expectFailure('invalid building level', () => new CityPageService({
  ...realData,
  buildings: realData.buildings.map((building, index) => index === 0 ? { ...building, level: 0 } : { ...building }),
}), 'INVALID_DATA');
expectFailure('incomplete non-empty building set', () => new CityPageService({
  ...realData,
  buildings: realData.buildings.slice(1),
}), 'INVALID_DATA');
assert.equal(negativeCaseCount, 8, 'missing, invalid and out-of-range cases must execute');

console.log(`T312 city page PASS: real-buildings=${realData.buildings.length}, components=${normal.components.length}, negative-cases=${negativeCaseCount}, normal/empty/insufficient/active/claimable`);
