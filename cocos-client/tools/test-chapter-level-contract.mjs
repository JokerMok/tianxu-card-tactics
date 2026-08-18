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
const decks = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/decks.json'), 'utf8'));
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
  () => assertChapterLevelContract(valid, manifest, decks),
  'valid chapter level contract must pass',
);
const terminalLevel = structuredClone(valid);
terminalLevel.chapterLevels[0].id = 'L12';
terminalLevel.chapterLevels[0].prerequisiteLevelId = 'L11';
assert.doesNotThrow(
  () => assertChapterLevelContract(terminalLevel, manifest, decks),
  'L12 and its chapter-local prerequisite must pass',
);
const waterEnvironment = structuredClone(valid);
waterEnvironment.chapterLevels[0].environmentElement = 'WATER';
assert.doesNotThrow(
  () => assertChapterLevelContract(waterEnvironment, manifest, decks),
  'a second legal environment must pass',
);

function expectFailure(label, mutate, expectedPath) {
  const fixture = structuredClone(valid);
  mutate(fixture);
  assert.throws(() => assertChapterLevelContract(fixture, manifest, decks), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

expectFailure('missing field', (fixture) => { delete fixture.chapterLevels[0].objectives; }, 'config/levels.chapterLevels[0].objectives');
expectFailure('invalid ID', (fixture) => { fixture.chapterLevels[0].id = 'L_01'; }, 'config/levels.chapterLevels[0].id');
expectFailure('out-of-chapter ID', (fixture) => { fixture.chapterLevels[0].id = 'L13'; }, 'config/levels.chapterLevels[0].id');
expectFailure('unknown enemy deck', (fixture) => { fixture.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels.chapterLevels[0].enemyDeckId');
expectFailure('invalid prerequisite', (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'C01'; }, 'config/levels.chapterLevels[0].prerequisiteLevelId');
expectFailure('invalid environment', (fixture) => { fixture.chapterLevels[0].environmentElement = 'WIND'; }, 'config/levels.chapterLevels[0].environmentElement');
expectFailure('invalid objective', (fixture) => { fixture.chapterLevels[0].objectives[0].type = 'ESCAPE'; }, 'config/levels.chapterLevels[0].objectives[0].type');
expectFailure('invalid objective target ID', (fixture) => { fixture.chapterLevels[0].objectives[1].targetId = 'U_001'; }, 'config/levels.chapterLevels[0].objectives[1].targetId');
expectFailure('non-positive survival rounds', (fixture) => { fixture.chapterLevels[0].objectives[2].rounds = 0; }, 'config/levels.chapterLevels[0].objectives[2].rounds');
expectFailure('invalid reward ID', (fixture) => { fixture.chapterLevels[0].rewards[0].id = 'U_001'; }, 'config/levels.chapterLevels[0].rewards[0].id');
expectFailure('invalid reward type', (fixture) => { fixture.chapterLevels[0].rewards[0].type = 'GOLD'; }, 'config/levels.chapterLevels[0].rewards[0].type');
expectFailure('missing reward quantity', (fixture) => { delete fixture.chapterLevels[0].rewards[0].quantity; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('non-positive reward quantity', (fixture) => { fixture.chapterLevels[0].rewards[0].quantity = 0; }, 'config/levels.chapterLevels[0].rewards[0].quantity');
expectFailure('missing failure condition', (fixture) => { delete fixture.chapterLevels[0].failureConditions; }, 'config/levels.chapterLevels[0].failureConditions');
expectFailure('invalid destroyed target ID', (fixture) => { fixture.chapterLevels[0].failureConditions[1].targetId = 'U_001'; }, 'config/levels.chapterLevels[0].failureConditions[1].targetId');

console.log('Chapter level contract: valid L01, L12, and WATER PASS; missing field, invalid ID, out-of-chapter ID, unknown enemy deck, invalid prerequisite, invalid environment, invalid objective, invalid objective target ID, non-positive survival rounds, invalid reward ID, invalid reward type, missing or non-positive reward quantity, missing failure condition, invalid destroyed target ID FAIL as expected');
