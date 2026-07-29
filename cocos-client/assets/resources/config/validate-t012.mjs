import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const manifest = read('manifest.json');
for (const name of ['units', 'cards', 'skills', 'effects', 'statuses']) assert.equal(manifest.tables[name], `config/${name}`);
const skills = read('skills.json').skills;
const effects = read('effects.json').effects;
const statuses = read('statuses.json').statuses;
const ids = (rows, prefix) => {
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  for (const row of rows) assert.match(row.id, new RegExp(`^${prefix}\\d{3}$`));
};
ids(skills, 'S'); ids(effects, 'E'); ids(statuses, 'ST');
assert.deepEqual(skills.map((row) => row.id), Array.from({length: 16}, (_, i) => `S${String(i + 1).padStart(3, '0')}`));
const effectIds = new Set(effects.map((row) => row.id));
const statusIds = new Set(statuses.map((row) => row.id));
for (const skill of skills) {
  assert.equal(skill.evidenceLevel, 'C'); assert.equal(skill.version, 1); assert.equal(skill.enabled, true);
  assert.ok(skill.targetType && skill.rangeShape && Number.isInteger(skill.rangeA) && Number.isInteger(skill.rangeB));
  assert.ok(Array.isArray(skill.effectIds) && skill.effectIds.length > 0);
  for (const effectId of skill.effectIds) assert.ok(effectIds.has(effectId), `${skill.id} effect reference`);
}
for (const effect of effects) {
  assert.equal(effect.evidenceLevel, 'C'); assert.equal(effect.version, 1); assert.equal(effect.enabled, true);
  assert.ok(Number.isInteger(effect.durationRounds) && effect.durationRounds >= 0);
  assert.equal('stackPolicy' in effect, false);
  if (effect.statusId) assert.ok(statusIds.has(effect.statusId), `${effect.id} status reference`);
}
for (const status of statuses) {
  assert.equal(status.evidenceLevel, 'C'); assert.equal(status.version, 1); assert.equal(status.enabled, true);
  assert.ok(['BUFF', 'DEBUFF', 'CONTROL'].includes(status.category));
  assert.ok(['REPLACE', 'REFRESH', 'ADD_VALUE'].includes(status.stackRule));
  assert.ok(['ROUND_START', 'ACTION_START', 'ROUND_END'].includes(status.tickTiming));
  assert.ok(Array.isArray(status.effectIds) && status.effectIds.length > 0);
  for (const effectId of status.effectIds) assert.ok(effectIds.has(effectId), `${status.id} effect reference`);
  assert.equal(typeof status.removable, 'boolean');
  assert.ok(Number.isInteger(status.maxStacks) && status.maxStacks >= 1 && status.maxStacks <= 3);
}
console.log('T012 config PASS: S001-S016, effects, statuses and references are loadable');
