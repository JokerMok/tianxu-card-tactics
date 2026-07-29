import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const configDir = import.meta.dirname;
const projectRoot = path.resolve(configDir, '../../../../');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'));
const manifest = readJson('manifest.json');
const unitTable = readJson('units.json');
const cardTable = readJson('cards.json');
const units = unitTable.units;
const cards = cardTable.cards;
const ids = Array.from({ length: 28 }, (_, index) => `U${String(index + 1).padStart(3, '0')}`);
const baseline = {
  U001: [8, 2, 2, 1, 1], U002: [5, 3, 1, 1, 1], U003: [5, 1, 0, 1, 2],
  U004: [4, 3, 0, 1, 3], U005: [4, 2, 0, 2, 1], U006: [3, 2, 0, 2, 2],
  U007: [4, 2, 0, 2, 1], U008: [10, 4, 2, 1, 1], U009: [4, 2, 0, 1, 1],
  U010: [4, 2, 0, 1, 3], U011: [7, 3, 1, 1, 1], U012: [6, 3, 0, 1, 3],
};
const races = new Set(['人族', '羽民', '鳞民', '山灵', '冥裔', '巧民', '异兽']);
const politicalFactions = new Set(['无籍行营', '朔垣军府', '天序神庭', '河中诸国', '离山仙盟', '山海诸庭', '归墟会']);
const roles = new Set(['GUARD', 'STRIKER', 'RANGED', 'HEALER', 'FAST', 'CONTROL', 'SUMMONER', 'ANCHOR']);
const attackChannels = new Set(['PHYSICAL', 'SPELL']);
const offenseTypes = new Set(['SLASH', 'PIERCE', 'IMPACT', 'SPELL']);
const defenseTypes = new Set(['LIGHT', 'HEAVY', 'GIANT', 'SPIRIT']);
const elements = new Set(['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH']);
const archetypes = new Set([
  'HUMANOID_INFANTRY', 'HUMANOID_SUPPORT', 'HUMANOID_BANNER', 'WINGED_HUMANOID', 'WINGED_RIDER',
  'WINGED_SCOUT', 'BEAST_CANINE', 'BEAST_GIANT', 'SPIRIT_HUMANOID', 'SPIRIT_CASTER', 'STONE_HUMANOID',
  'STONE_ARTILLERY', 'SCALED_INFANTRY', 'SCALED_SUPPORT', 'SCALED_BINDER', 'STONE_GUARDIAN', 'STONE_GIANT',
  'SPIRIT_GUARDIAN', 'SPIRIT_SCRIBE', 'CONSTRUCT_GUARD', 'CONSTRUCT_ARTILLERY', 'CONSTRUCT_ENGINEER',
  'CONSTRUCT_CARRIER', 'BEAST_RAPTOR', 'BEAST_RHINO',
]);

assert.equal(manifest.tables.units, 'config/units');
assert.equal(manifest.tables.cards, 'config/cards');
assert.deepEqual(units.map((unit) => unit.id), ids, 'units must contain U001-U028 in order');
const unitCards = cards.filter((card) => card.cardType === 'UNIT');
const skillCards = cards.filter((card) => card.cardType === 'SKILL');
assert.deepEqual(unitCards.map((card) => card.id), ids, 'unit cards must contain U001-U028 in order');
assert.deepEqual(skillCards.map((card) => card.id), ['S001','S002','S003','S004','S005','S006'], 'skill cards must be stable');
assert.equal(new Set(units.map((unit) => unit.id)).size, 28, 'unit IDs must be unique');
assert.equal(new Set(cards.map((card) => card.id)).size, 34, 'card IDs must be unique');

for (const unit of units) {
  for (const [field, min, max] of [['maxHp', 1, 99], ['attack', 0, 30], ['armor', 0, 20], ['spellResist', 0, 20], ['move', 0, 4], ['range', 1, 12]]) {
    assert.equal(Number.isInteger(unit[field]) && unit[field] >= min && unit[field] <= max, true, `${unit.id}.${field} range`);
  }
  assert.equal(unit.footprintCells, 1, `${unit.id}.footprintCells`);
  assert.equal(unit.version, 1);
  assert.equal(unit.enabled, true);
  assert.equal(unit.evidenceLevel, 'C');
  assert.equal('faction' in unit, false, `${unit.id} must not use legacy faction`);
  assert.equal(races.has(unit.race), true, `${unit.id}.race`);
  assert.equal(politicalFactions.has(unit.politicalFaction), true, `${unit.id}.politicalFaction`);
  assert.equal(roles.has(unit.role), true, `${unit.id}.role`);
  assert.equal(attackChannels.has(unit.attackChannel), true, `${unit.id}.attackChannel`);
  assert.equal(offenseTypes.has(unit.offenseType), true, `${unit.id}.offenseType`);
  assert.equal(defenseTypes.has(unit.defenseType), true, `${unit.id}.defenseType`);
  assert.equal(elements.has(unit.element), true, `${unit.id}.element`);
  assert.equal(archetypes.has(unit.visualArchetype), true, `${unit.id}.visualArchetype`);
  assert.equal(Array.isArray(unit.abilityIds) && unit.abilityIds.length > 0, true, `${unit.id}.abilityIds`);
  assert.equal(unit.abilityIds.every((id) => /^A\d{3}$/.test(id)), true, `${unit.id}.abilityIds format`);
  if (unit.role === 'RANGED') assert.equal(unit.maxHp <= 6, true, `${unit.id} ranged durability cap`);
}

for (const [id, values] of Object.entries(baseline)) {
  const unit = units.find((candidate) => candidate.id === id);
  assert.deepEqual([unit.maxHp, unit.attack, unit.armor, unit.move, unit.range], values, `${id} R1 baseline changed`);
}

for (const id of ids.slice(12)) {
  const unit = units.find((candidate) => candidate.id === id);
  assert.notEqual(unit.politicalFaction, 'NONE', `${id} must have a real political faction`);
  assert.notEqual(unit.race, 'NONE', `${id} must have a real race`);
}

const unitById = new Map(units.map((unit) => [unit.id, unit]));
for (const card of unitCards) {
  const unit = unitById.get(card.unitId);
  assert.ok(unit, `${card.id} unit reference`);
  assert.equal(card.cardType, 'UNIT');
  assert.equal(card.race, unit.race, `${card.id} race mismatch`);
  assert.equal(card.politicalFaction, unit.politicalFaction, `${card.id} political faction mismatch`);
  assert.equal('faction' in card, false, `${card.id} must not use legacy faction`);
  assert.equal(Number.isInteger(card.prepare) && card.prepare >= 1 && card.prepare <= 12, true, `${card.id}.prepare`);
  assert.equal(Number.isInteger(card.rarity) && card.rarity >= 1 && card.rarity <= 6, true, `${card.id}.rarity`);
  assert.equal(Number.isInteger(card.copyLimit) && card.copyLimit >= 1 && card.copyLimit <= 4, true, `${card.id}.copyLimit`);
  assert.equal(card.version, 1);
  assert.equal(card.enabled, true);
  assert.equal(card.evidenceLevel, 'C');
}
for (const card of skillCards) {
  assert.equal(card.skillId, card.id);
  assert.equal(card.race, 'NONE');
  assert.equal(card.politicalFaction, 'NONE');
}

const designDoc = fs.readFileSync(path.join(projectRoot, '文档/数值与阵营配置-v1.0.md'), 'utf8');
for (const id of ids.slice(12)) assert.match(designDoc, new RegExp(`\\| ${id} \\|`), `${id} missing from design document`);
assert.match(designDoc, /`race` 表示族属，`politicalFaction` 表示政治归属/);
assert.doesNotMatch(designDoc, /U01[3-9].*NONE|U02[0-8].*NONE/);

console.log('T010 config PASS: U001-U028 loadable JSON, R1 baselines preserved, U013-U028 numeric fields and real political factions validated');
