import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RecoveredContent } from './RecoveredContent.ts';
import { getTerrainRule, TERRAIN_SKILL_IDS } from './TerrainRules.ts';

const catalog = JSON.parse(readFileSync(new URL('../../resources/recovered/catalog.json', import.meta.url), 'utf8'));
const topography = JSON.parse(readFileSync(new URL('../../resources/recovered/tables/main/33e04686a5f6d15ae853.json', import.meta.url), 'utf8'));
const content = new RecoveredContent(catalog, 'main');

test('terrain rules bind all 13 recovered skill rows without free-text execution', () => {
  assert.equal(TERRAIN_SKILL_IDS.length, 13);
  const expected = new Map([
    [50731, [50704, 6, 8, 10]], [50732, [50704, 8, 7, 10]],
    [50733, [50704, 10, 6, 10]], [50734, [50704, 12, 5, 10]],
    [50741, [50705, 4, 9, 10]], [50742, [50705, 6, 8, 10]],
    [50743, [50705, 8, 7, 10]], [50744, [50705, 10, 6, 10]],
    [50806, [50806, 3, 1, 10]], [50807, [50807, 3, 1, 10]],
    [50808, [50808, 3, 1, 10]], [50809, [50809, 6, 1, 10]],
    [50903, [50903, 0, 5, 5]],
  ]);
  for (const skillId of TERRAIN_SKILL_IDS) {
    const raw = content.skill(skillId).raw;
    const rule = getTerrainRule(content, skillId);
    const [topographyId, count, start, end] = expected.get(skillId);
    assert.equal(rule.skillId, skillId);
    assert.equal(rule.topographyId, topographyId);
    assert.equal(rule.count, count);
    assert.equal(rule.startCol, start);
    assert.equal(rule.endCol, end);
    assert.equal(rule.topographyId, Number(raw.DamValue));
    assert.equal(rule.count, skillId === 50903 ? 0 : Number(raw.CureValue));
    assert.doesNotThrow(() => JSON.stringify(rule));
  }
  assert.equal(getTerrainRule(content, 50810), undefined);
});

test('topography and effect tables supply durations, damage, summons and ward behavior', () => {
  const sourceRows = new Map(topography.rows.map(row => [Number(row.ID), row]));
  const expectations = new Map([
    [50704, [8, 40052]], [50705, [8, 40053]], [50806, [1, 40503]],
    [50807, [1, 40504]], [50808, [0, 40056]], [50809, [0, 40057]], [50903, [0, 40801]],
  ]);
  for (const [id, [turns, effectId]] of expectations) {
    const row = sourceRows.get(id);
    assert.equal(Number(row.turns), turns);
    assert.equal(Number(row.ability1), effectId);
  }

  assert.deepEqual(getTerrainRule(content, 50731), {
    skillId: 50731, serverClass: 19, topographyId: 50704, effectId: 40052,
    placement: 'scatter', count: 6, startCol: 8, endCol: 10, remainingTurns: 8,
    entryDamage: 0, stayDamage: 5, damageType: 2, blocksPositiveStatuses: false, summonChoices: [],
  });
  assert.deepEqual(getTerrainRule(content, 50741).stayDamage, 7);
  assert.deepEqual(getTerrainRule(content, 50806).summonChoices, [
    { monsterId: 9091, threshold: 90 }, { monsterId: 9093, threshold: 100 },
  ]);
  assert.deepEqual(getTerrainRule(content, 50807).summonChoices, [
    { monsterId: 9092, threshold: 90 }, { monsterId: 9094, threshold: 100 },
  ]);
  assert.deepEqual([getTerrainRule(content, 50808).entryDamage, getTerrainRule(content, 50808).stayDamage], [3, 3]);
  assert.deepEqual([getTerrainRule(content, 50809).entryDamage, getTerrainRule(content, 50809).stayDamage], [5, 5]);
  assert.equal(getTerrainRule(content, 50903).blocksPositiveStatuses, true);
});
