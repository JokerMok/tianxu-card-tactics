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
  assert.ok(skill.targetType && skill.rangeShape && Number.isInteger(skill.rangeA) && Number.isInteger(skill.rangeB));
  assert.ok(Array.isArray(skill.effectIds) && skill.effectIds.length > 0);
  for (const effectId of skill.effectIds) assert.ok(effectIds.has(effectId), `${skill.id} effect reference`);
}
for (const effect of effects) {
  assert.ok(Number.isInteger(effect.durationRounds) && effect.durationRounds >= 0);
  assert.ok(['REPLACE', 'REFRESH', 'MAX'].includes(effect.stackPolicy));
  if (effect.statusId) assert.ok(statusIds.has(effect.statusId), `${effect.id} status reference`);
}
for (const status of statuses) {
  assert.ok(Number.isInteger(status.durationRounds) && status.durationRounds >= 0);
  assert.ok(Number.isInteger(status.maxStacks) && status.maxStacks >= 1 && status.maxStacks <= 3);
  assert.ok(['REPLACE', 'REFRESH', 'MAX'].includes(status.stackPolicy));
}
console.log('T012 config PASS: S001-S016, effects, statuses and references are loadable');
