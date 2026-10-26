import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceDisplayName } from '../assets/scripts/game/GameText.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const resources = path.resolve(here, '../assets/resources');
const catalog = JSON.parse(fs.readFileSync(path.join(resources, 'recovered/catalog.json'), 'utf8'));
catalog.localization = JSON.parse(fs.readFileSync(path.join(resources, 'localization/game-zh.json'), 'utf8'));

const expected = new Map([
  ['60001', ['Goblin Bandit', '哥布林强盗']],
  ['60002', ['Goblin Maurader', '哥布林掠夺者']],
  ['60003', ['Ogre Destroyer', '食人魔毁灭者']],
  ['60005', ['Ogre Marauder', '食人魔掠夺者']],
  ['60007', ['Goblin Captain', '哥布林头目']],
]);

test('Chapter 1 fixed enemy display names are candidate Chinese without changing source identity', () => {
  for (const [id, [originalName, displayName]] of expected) {
    const card = catalog.scopes.main.cards[id];
    const monster = catalog.scopes.main.monsters[id];
    const localized = catalog.localization.cards[`main:card:${id}`];
    assert.equal(card.raw.Name, originalName);
    assert.equal(monster.Name, originalName);
    assert.equal(localized.originalName, originalName);
    assert.equal(localized.status, 'candidate');
    assert.equal(localized.sourceRow, card.raw._row);
    assert.equal(sourceDisplayName(catalog, monster.Name), displayName);
  }
});
