import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HERO_PAGE_SCHEMA_VERSION,
  HeroPageError,
  HeroPageService,
  createDefaultHeroPageData,
  createEmptyHeroPageData,
  createHeroPageData,
} from '../assets/scripts/meta/ui/pages/deck-hero-adventure/hero/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const heroRoot = path.join(root, 'assets/scripts/meta/ui/pages/deck-hero-adventure/hero');
const targetFiles = ['HeroContracts.ts', 'HeroComponents.ts', 'HeroPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(heroRoot, file), 'utf8')]));
assert.equal(targetSource.size, targetFiles.length, 'the verifier must read every real hero target file');
assert.match(targetSource.get('HeroComponents.ts'), /createHeroPageComponents/);
assert.match(targetSource.get('HeroPageService.ts'), /class HeroPageService/);
assert.match(targetSource.get('HeroPageService.ts'), /createHeroPageData/);
assert.match(targetSource.get('HeroPageService.ts'), /parseSaved/);

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name), 'utf8'));
}

const professionsTable = readConfig('professions.json');
const cardsTable = readConfig('cards.json');
const decksTable = readConfig('decks.json');
const professions = professionsTable.professions.filter((profession) => profession.enabled !== false).map((profession) => ({
  ...profession,
  skillIds: [...profession.skillIds],
}));
const cards = cardsTable.cards.filter((card) => card.enabled !== false).map((card) => ({ ...card }));
const decks = decksTable.decks.filter((deck) => deck.enabled !== false).map((deck) => ({
  ...deck,
  cardEntries: deck.cardEntries.map((entry) => ({ ...entry })),
}));
const hero = {
  id: 'H001',
  name: '岳沉戈',
  level: 8,
  xp: 320,
  power: 1680,
  professionId: 'P001',
  equipment: [
    { slot: 'weapon', name: '玄铁断刃', level: 5 },
    { slot: 'helmet', name: '边军兜鍪', level: 3 },
  ],
};
const data = createHeroPageData({ hero, professions, cards, decks });
const defaultPage = new HeroPageService(createDefaultHeroPageData());
assert.equal(defaultPage.snapshot().validation.valid, true, 'default page data must also be a valid component baseline');
assert.equal(defaultPage.snapshot().components.find(({ id }) => id === 'deck')?.cardCount, 30);

assert.equal(data.schemaVersion, HERO_PAGE_SCHEMA_VERSION);
assert.deepEqual(data.professions.map(({ id }) => id), ['P001', 'P002', 'P003', 'P004']);
assert.equal(data.decks.length, 4, 'every real profession must have a page deck mapping');
assert.deepEqual(data.decks.map(({ professionId }) => professionId), ['P001', 'P002', 'P003', 'P004']);
assert.equal(data.decks.find(({ professionId }) => professionId === 'P001')?.id, 'D001');
assert(data.cards.some(({ id }) => id === 'S001'), 'the page must retain real skill card metadata');

let negativeCaseCount = 0;
function expectHeroError(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => error instanceof HeroPageError && error.code === code, label);
}

const saves = [];
const page = new HeroPageService({ data, persist: (serialized) => saves.push(serialized) });
const initial = page.snapshot();
assert.deepEqual(initial.components.map(({ id }) => id), ['header', 'profile', 'profession-selector', 'detail', 'deck']);
assert.equal(initial.selectedProfessionId, 'P001');
assert.equal(initial.validation.valid, true, 'the real P001 deck must validate');
assert.equal(initial.components.find(({ id }) => id === 'deck')?.cardCount, 30);
assert.equal(initial.components.find(({ id }) => id === 'deck')?.unitCards, 27);
assert.equal(initial.components.find(({ id }) => id === 'deck')?.skillCards, 3);

for (const profession of professions) {
  const result = page.selectProfession(profession.id);
  assert.equal(result.accepted, true);
  assert.equal(result.professionId, profession.id);
  const snapshot = page.snapshot();
  const detail = snapshot.components.find(({ id }) => id === 'detail');
  const deck = snapshot.components.find(({ id }) => id === 'deck');
  assert.equal(snapshot.selectedProfessionId, profession.id);
  assert.equal(detail?.professionId, profession.id);
  assert.equal(deck?.professionId, profession.id);
  assert.equal(deck?.valid, true, `${profession.id} must map to a valid real-card deck`);
  assert.deepEqual(deck?.cards.filter(({ cardType }) => cardType === 'SKILL').map(({ cardId }) => cardId), profession.skillIds);
}
assert.deepEqual(page.selectProfession('P004'), {
  accepted: true,
  changed: false,
  reason: 'same',
  professionId: 'P004',
  deckId: 'D001-P004',
});
assert.equal(saves.length >= 3, true, 'changed profession selections must use the real persistence callback');

// Empty data has a real empty component and an inert interaction surface.
const empty = new HeroPageService(createEmptyHeroPageData());
assert.deepEqual(empty.snapshot().components, [{
  id: 'hero-empty',
  kind: 'empty',
  state: 'empty',
  reason: 'noHero',
  message: '当前没有可查看的主将。',
}]);
assert.deepEqual(empty.selectProfession('P001'), { accepted: false, changed: false, reason: 'empty', professionId: null, deckId: null });
assert.deepEqual(empty.selectProfessionAt(0), { accepted: false, changed: false, reason: 'empty', professionId: null, deckId: null });

// Illegal ids, malformed data, and out-of-range inputs must be rejected by the service.
expectHeroError('unknown profession', () => page.selectProfession('P999'), 'PROFESSION_NOT_FOUND');
expectHeroError('empty profession id', () => page.selectProfession(''), 'INVALID_DATA');
expectHeroError('negative profession index', () => page.selectProfessionAt(-1), 'INDEX_OUT_OF_RANGE');
expectHeroError('profession index past end', () => page.selectProfessionAt(4), 'INDEX_OUT_OF_RANGE');
expectHeroError('fractional profession index', () => page.selectProfessionAt(1.5), 'INVALID_DATA');
expectHeroError('unknown interaction', () => page.interact({ type: 'missing' }), 'INVALID_ARGUMENT');
const missingPageField = { ...data };
delete missingPageField.subtitle;
expectHeroError('missing page field', () => new HeroPageService(missingPageField), 'MISSING_FIELD');
expectHeroError('invalid page version', () => new HeroPageService({ ...data, schemaVersion: 2 }), 'INVALID_DATA');

const invalidMapping = {
  ...data,
  decks: data.decks.filter(({ professionId }) => professionId !== 'P004'),
};
const invalidPage = new HeroPageService({ data: invalidMapping, initialProfessionId: 'P004' });
assert.equal(invalidPage.snapshot().validation.valid, false);
assert.deepEqual(invalidPage.snapshot().validation.errors, ['DECK_PROFESSION_MAPPING_MISSING']);
assert.equal(invalidPage.snapshot().components.find(({ id }) => id === 'deck')?.state, 'invalid');

// Constructor inputs and every outward-facing snapshot are detached and deeply frozen.
const mutableData = structuredClone(data);
const isolated = new HeroPageService(mutableData);
mutableData.hero.name = '外部篡改';
mutableData.professions[0].skillIds[0] = 'S999';
mutableData.decks[0].cardEntries[0].count = 99;
assert.equal(isolated.snapshot().components.find(({ id }) => id === 'profile')?.name, '岳沉戈');
assert.equal(isolated.snapshot().components.find(({ id }) => id === 'deck')?.cardCount, 30);
const frozen = isolated.snapshot();
assert.equal(Object.isFrozen(frozen), true);
assert.equal(Object.isFrozen(frozen.components), true);
assert.equal(Object.isFrozen(frozen.components[1]), true);
assert.equal(Object.isFrozen(frozen.components[1].equipment), true);
assert.equal(Object.isFrozen(frozen.components[4].cards), true);
assert.throws(() => { frozen.selectedProfessionId = 'P002'; }, TypeError);
assert.throws(() => { frozen.components[4].cards.push({}); }, TypeError);
const detachedData = isolated.pageData;
detachedData.hero.name = '页面外部修改';
assert.equal(isolated.pageData.hero.name, '岳沉戈');

// Save/restore is deterministic, detached, and idempotent.
isolated.selectProfession('P003');
const serialized = isolated.serialize();
assert.equal(serialized, '{"schemaVersion":1,"pageId":"hero","selectedProfessionId":"P003"}');
const restored = HeroPageService.restore(data, serialized);
assert.equal(restored.serialize(), serialized);
assert.deepEqual(restored.snapshot(), isolated.snapshot());
const restoredAgain = restored.restore(serialized);
assert.deepEqual(restoredAgain, restored.snapshot());
const saveObject = JSON.parse(serialized);
saveObject.selectedProfessionId = 'P001';
assert.equal(restored.snapshot().selectedProfessionId, 'P003');
expectHeroError('malformed save', () => HeroPageService.restore(data, 'not-json'), 'INVALID_SAVE');
expectHeroError('save version', () => HeroPageService.restore(data, serialized.replace('"schemaVersion":1', '"schemaVersion":2')), 'SAVE_VERSION');
expectHeroError('save unknown profession', () => HeroPageService.restore(data, serialized.replace('P003', 'P999')), 'PROFESSION_NOT_FOUND');

assert.equal(negativeCaseCount, 11, 'all malformed, illegal, and out-of-range cases must execute');
console.log(`T310 hero page PASS: professions=${data.professions.length}, decks=${data.decks.length}, saves=${saves.length}, negative-cases=${negativeCaseCount}, normal/empty/invalid, deep-freeze, input-isolation, save-restore-idempotent`);
