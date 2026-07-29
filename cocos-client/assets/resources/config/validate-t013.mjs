import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const dir = import.meta.dirname;
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const manifest = read('manifest.json');
for (const t of ['professions','decks']) assert.equal(manifest.tables[t], `config/${t}`);
const cards = read('cards.json').cards;
const profs = read('professions.json').professions;
const decks = read('decks.json').decks;
const cardIds = new Set(cards.map((c) => c.id));
const skillIds = new Set(read('skills.json').skills.map((s) => s.id));
const skillCardIds = new Set(cards.filter((c) => c.cardType === 'SKILL').map((c) => c.skillId));
assert.equal(profs.length, 4);
assert.equal(new Set(profs.map((p) => p.id)).size, 4);
for (const p of profs) { assert.ok(p.skillIds.length > 0); for (const id of p.skillIds) { assert.ok(skillIds.has(id)); assert.ok(skillCardIds.has(id)); } }
assert.ok(decks.length >= 1);
for (const deck of decks) {
  assert.ok(profs.some((p) => p.id === deck.profession));
  assert.equal(deck.totalCards, 30);
  assert.equal(deck.cardEntries.reduce((sum, e) => sum + e.count, 0), 30);
  assert.ok(deck.cardEntries.filter((e) => e.cardId.startsWith('U')).reduce((sum, e) => sum + e.count, 0) >= 24);
  assert.ok(deck.cardEntries.filter((e) => e.cardId.startsWith('S')).reduce((sum, e) => sum + e.count, 0) <= 6);
  for (const entry of deck.cardEntries) { assert.ok(cardIds.has(entry.cardId)); assert.ok(entry.count >= 1 && entry.count <= 4); }
  const profession = profs.find((p) => p.id === deck.profession);
  for (const entry of deck.cardEntries.filter((e) => e.cardId.startsWith('S'))) assert.ok(profession.skillIds.includes(entry.cardId), `${deck.id} skill not allowed by profession`);
}
console.log('T013 config PASS: 4 professions, 30-card deck, unit floor and skill cap validated');
