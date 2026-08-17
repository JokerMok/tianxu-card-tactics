import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleLayoutController } from './battle-layout-controller.ts';

const source = fs.readFileSync(new URL('./battle-layout-controller.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|require\()\s*["']node:/, 'layout controller must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|cc|React|setTimeout|setInterval|Date)\b/, 'layout controller must not require a host runtime');
assert.match(source, /Object\.freeze/, 'published layouts must be immutable');

function input(width, height, safeInsets = {}) {
  return [{ width, height }, { top: 0, right: 0, bottom: 0, left: 0, ...safeInsets }];
}

function layout(viewport, safeInsets) {
  const controller = new BattleLayoutController();
  const result = controller.resize(viewport, safeInsets);
  assert.notEqual(result, null);
  assert.strictEqual(result, controller.snapshot);
  return controller;
}

function assertPoint(actual, expected) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
}

// Common desktop landscape targets have a usable 16:9 design surface.
for (const [width, height] of [[1280, 720], [1920, 1080]]) {
  const controller = layout(...input(width, height));
  const snapshot = controller.snapshot;
  assert.deepEqual(snapshot.safeRect, { x: 0, y: 0, width, height });
  assert.deepEqual(snapshot.contentRect, { x: 0, y: 0, width, height });
  assert.equal(snapshot.scale, width / 1920);
  assert.deepEqual(snapshot.topUiRect, { x: 0, y: 0, width, height: height / 6 });
  assert.deepEqual(snapshot.bottomUiRect, { x: 0, y: height - height / 6, width, height: height / 6 });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.safeRect), true);
  assert.equal(Object.isFrozen(snapshot.contentRect), true);
  assert.equal(Object.isFrozen(snapshot.topUiRect), true);
  assert.equal(Object.isFrozen(snapshot.bottomUiRect), true);
  assert.throws(() => { snapshot.contentRect.width = 0; }, TypeError);
}

// Android landscape cutouts shrink the safe area without corrupting 16:9 fitting.
{
  const controller = layout(...input(2400, 1080, { left: 96, right: 120, top: 24, bottom: 36 }));
  const snapshot = controller.snapshot;
  assert.deepEqual(snapshot.safeRect, { x: 96, y: 24, width: 2184, height: 1020 });
  assert.deepEqual(snapshot.contentRect, { x: 281.33333333333337, y: 24, width: 1813.3333333333333, height: 1020 });
  assert.equal(snapshot.scale, 1020 / 1080);
  assert.deepEqual(snapshot.topUiRect, { x: 281.33333333333337, y: 24, width: 1813.3333333333333, height: 170 });
  assert.deepEqual(snapshot.bottomUiRect, { x: 281.33333333333337, y: 874, width: 1813.3333333333333, height: 170 });
}

// Coordinates only map inside the fitted content area; edges, insets, and letterboxing are rejected.
{
  const controller = layout(...input(2400, 1080, { left: 96, right: 120, top: 24, bottom: 36 }));
  assertPoint(controller.screenToDesign({ x: 281.33333333333337 + 960 * (1020 / 1080), y: 24 + 540 * (1020 / 1080) }), { x: 960, y: 540 });
  assertPoint(controller.screenToDesign({ x: 281.33333333333337 + 1919 * (1020 / 1080), y: 24 + 1079 * (1020 / 1080) }), { x: 1919, y: 1079 });
  assertPoint(controller.designToScreen({ x: 1919, y: 1079 }), { x: 2093.722222222222, y: 1043.0555555555557 });
  for (const point of [
    { x: 95, y: 200 },
    { x: 96, y: 12 },
    { x: 100, y: 1050 },
    { x: 100, y: 30 },
    { x: 2200, y: 200 },
    { x: 281.33333333333337 - 0.01, y: 200 },
    { x: 2094.6666666666665, y: 200 },
  ]) assert.equal(controller.screenToDesign(point), null);
  for (const point of [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1920, y: 0 }, { x: 0, y: 1080 }]) {
    assert.equal(controller.designToScreen(point), null);
  }
}

// A resize replaces every published object; old layouts and mappings cannot leak into the new one.
{
  const controller = layout(...input(1920, 1080));
  const before = controller.snapshot;
  const result = controller.resize(...input(1280, 720));
  assert.notEqual(result, null);
  assert.notStrictEqual(controller.snapshot, before);
  assert.deepEqual(before.contentRect, { x: 0, y: 0, width: 1920, height: 1080 });
  assertPoint(controller.designToScreen({ x: 1919, y: 1079 }), { x: 1279.3333333333333, y: 719.3333333333333 });
}

// Hostile inputs are a rejected, non-throwing transition. Values are read once, then detached.
{
  const controller = layout(...input(1920, 1080));
  const before = controller.snapshot;
  const [viewport, safeInsets] = input(1280, 720);
  assert.notEqual(controller.resize(viewport, safeInsets), null);
  viewport.width = 4;
  assert.equal(controller.snapshot.viewport.width, 1280);

  let getterReads = 0;
  const accessorViewport = { height: 720 };
  Object.defineProperty(accessorViewport, 'width', {
    enumerable: true,
    get() { getterReads += 1; return getterReads === 1 ? 1280 : 4; },
  });
  const throwingGetter = { height: 720 };
  Object.defineProperty(throwingGetter, 'width', { enumerable: true, get() { throw new Error('no viewport'); } });
  const accessorInsets = { top: 0, right: 0, bottom: 0 };
  Object.defineProperty(accessorInsets, 'left', { enumerable: true, get() { throw new Error('no inset'); } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error('no proxy'); } });
  for (const [viewportValue, insetValue] of [
    [null, safeInsets],
    [undefined, safeInsets],
    [{}, safeInsets],
    ...[input(720, 1280), input(1280, 720, { left: 700, right: 700 })],
    [accessorViewport, safeInsets],
    [throwingGetter, safeInsets],
    [viewport, accessorInsets],
    [proxy, safeInsets],
  ]) {
    assert.doesNotThrow(() => controller.resize(viewportValue, insetValue));
    assert.equal(controller.resize(viewportValue, insetValue), null);
    assert.equal(controller.snapshot, null);
  }
  assert.equal(getterReads, 0, 'accessors must be rejected before their getter runs');
  assert.notStrictEqual(before, controller.snapshot);
  assert.equal(controller.screenToDesign(null), null);
  assert.equal(controller.designToScreen(new Proxy({}, { get() { throw new Error('no point'); } })), null);

  const resilient = layout(...input(1280, 720));
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.doesNotThrow(() => resilient.snapshot.screenToDesign(revoked.proxy));
  assert.equal(resilient.snapshot.screenToDesign(revoked.proxy), null);
}
