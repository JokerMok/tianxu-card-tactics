import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual Creator output. Source-only TS mocks missed Creator's
// iterableIsArray spread transform, which turned a Set into [Set] at runtime.
const modules = new Map();
const context = vm.createContext({ console, Set, Map, Promise, Date, URL,
  System: { register(name, dependencies, factory) {
    if (Array.isArray(name)) { dependencies(() => {}, {}).execute(); return; }
    modules.set(name, { dependencies, factory });
  } } });
for (const file of ['.local/web/src/chunks/bundle.js', '.local/web/assets/main/index.js']) {
  vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
}
class Color { constructor(...value) { this.value = value; } }
class UITransform {}
class Vec3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
const cc = { Color, UITransform, Vec3, Node: { EventType: { TOUCH_START: 'start', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' } }, cclegacy: { _RF: { push() {}, pop() {} } } };
const loaded = new Map([['cc', cc]]);
function load(name) {
  if (loaded.has(name)) return loaded.get(name);
  const definition = modules.get(name);
  assert.ok(definition, `missing built module ${name}`);
  const output = {}; loaded.set(name, output);
  const definitionResult = definition.factory((key, value) => {
    if (typeof key === 'object') Object.assign(output, key); else output[key] = value;
    return value;
  });
  definition.dependencies.forEach((dependency, index) => {
    const absolute = dependency.startsWith('.') ? new URL(dependency, name).href : dependency;
    definitionResult.setters[index]?.(load(absolute));
  });
  definitionResult.execute(); return output;
}
const { CardDeckWindow } = load('chunks:///_virtual/CardDeckWindow.ts');
const catalog = JSON.parse(readFileSync('cocos-client/assets/resources/recovered/catalog.json', 'utf8'));
const deck = new CardDeckWindow({}, {}, catalog, '', {});
deck.actor = { cards: { 'main:card:1': 1, 'main:card:19': 2 }, deck: ['main:card:1'] };
deck.ensureSecondaryFilter();
assert.deepEqual(Array.from(deck.availableRaces(false)), [1]);
assert.equal(typeof deck.race, 'number');
assert.deepEqual(Array.from(deck.filteredCards(), card => card.id), ['main:card:1', 'main:card:19']);

// A cross-pane drop is a captured touch canceled outside the source card.
const handlers = {};
deck.draft = []; deck.initialDeck = ''; deck.dirty = false;
deck.root = { getComponent: () => ({ convertToNodeSpaceAR: point => point }) };
deck.redraw = () => {};
deck.bindCardGesture({ on: (name, fn) => { handlers[name] = fn; } }, 'library', 'main:card:1');
handlers.start({ getUILocation: () => ({ x: 200, y: 0 }) });
handlers.cancel({ getUILocation: () => ({ x: -200, y: 0 }) });
assert.deepEqual(Array.from(deck.draft), ['main:card:1'], 'cross-pane cancellation must add the owned card');

const { BattleSceneView } = load('chunks:///_virtual/BattleSceneView.ts');
const battle = Object.create(BattleSceneView.prototype);
const order = [];
const display = (id, y) => ({ node: { position: { y }, setSiblingIndex(index) { order.push([id, index]); } }, hp: { string: '' }, attack: { string: '' }, dying: false });
battle.displays = new Map([['front', display('front', -40)], ['back', display('back', 40)]]);
battle.presentation = { locked: true, visibleState: { units: [{ id: 'front', hp: 3, maxHp: 5 }, { id: 'back', hp: 2, maxHp: 5 }] } };
battle.disposed = false;
battle.syncDisplays();
assert.deepEqual(order, [['back', 0], ['front', 1]]);
console.log('PASS: actual Creator output preserves numeric card filters and actor foot-depth order. This is a built-code check with minimal cc mocks, not visual acceptance.');
