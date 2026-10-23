#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { evaluateRecoveredTimeline, recoveredChildFrame } from '../assets/scripts/game/RecoveredTimeline.ts';

const identity = { a: 1, b: 0, c: 0, d: 1, tx_px: 0, ty_px: 0 };
const controls = [
  { op: 'place', depth: 1, frame: 2, character_id: 7, asset_id: 'first', matrix: identity },
  { op: 'place', depth: 1, frame: 3, move: true, inherit_missing_fields: true,
    matrix: { ...identity, tx_px: 9 } },
  { op: 'place', depth: 1, frame: 4, move: true, inherit_missing_fields: true,
    character_id: 7, asset_id: 'first' },
];
assert.equal(evaluateRecoveredTimeline(controls, 1).size, 0, 'a delayed child must not exist early');
assert.equal(evaluateRecoveredTimeline(controls, 3).get(1).placedFrame, 2,
  'a matrix-only Move must retain the child clock');
assert.equal(evaluateRecoveredTimeline(controls, 3).get(1).matrix.tx_px, 9);
assert.equal(evaluateRecoveredTimeline(controls, 4).get(1).placedFrame, 4,
  'explicitly placing the same character again must restart it');

const parentState = evaluateRecoveredTimeline(controls, 2).get(1);
const fastChild = { declared_frames: 8, show_frame_count: 8, fps: 20 };
assert.equal(recoveredChildFrame(2, 10, parentState, fastChild), 1);
assert.equal(recoveredChildFrame(3, 10, parentState, fastChild), 3,
  'a child uses elapsed time since placement and its own fps');
assert.equal(recoveredChildFrame(1, 10, { ...parentState, placedFrame: 1 }, fastChild), 1,
  'wrapping a parent loop restarts its child');

// A second placement clock is evaluated from the already resolved child frame,
// which covers multi-level nesting without leaking the root clock downward.
const middleControls = [{ op: 'place', depth: 2, frame: 2, character_id: 8, matrix: identity }];
const middleFrame = recoveredChildFrame(3, 10, parentState, fastChild);
const grandchildState = evaluateRecoveredTimeline(middleControls, middleFrame).get(2);
assert.equal(middleFrame, 3);
assert.equal(recoveredChildFrame(middleFrame, 20, grandchildState,
  { declared_frames: 4, show_frame_count: 4, fps: 5 }), 1);

const root = resolve(import.meta.dirname, '..', '..');
const catalog = JSON.parse(await readFile(resolve(root, 'cocos-client/assets/resources/recovered/catalog.json'), 'utf8'));
const replacementTimeline = catalog.timelines['timeline:00423899f2adfbae01d2'];
assert.ok(replacementTimeline, 'the pinned recovered source timeline sample is absent');
const replaced = evaluateRecoveredTimeline(replacementTimeline.controls, 2).get(1);
assert.equal(replaced.characterId, 32);
assert.equal(replaced.placedFrame, 2, 'the real source frame replacement must restart its display object');
const pureMoveTimeline = catalog.timelines['timeline:01174d5ae5e78688b652'];
assert.ok(pureMoveTimeline, 'the pinned recovered source Move sample is absent');
const moved = evaluateRecoveredTimeline(pureMoveTimeline.controls, 2).get(2);
assert.equal(moved.characterId, 63);
assert.equal(moved.placedFrame, 1, 'the real source matrix-only Move must preserve placement time');

// Exercise the public action lifecycle against a deliberately small Cocos mock.
// This verifies callbacks and handles, but it is not real-engine visual acceptance.
const scratch = await mkdtemp(resolve(tmpdir(), 'recovered-animation-lifecycle-'));
const execFile = promisify(execFileCallback);
try {
  const packageDir = resolve(scratch, 'node_modules/cc');
  await writeFile(resolve(scratch, 'package.json'), '{"type":"module"}');
  await mkdir(packageDir, { recursive: true });
  await writeFile(resolve(packageDir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await writeFile(resolve(packageDir, 'index.js'), `
export class Node {
  constructor(name=''){ this.name=name; this.children=[]; this.isValid=true; this.active=true; this.position={x:0,y:0,z:0}; this.scale={x:1,y:1,z:1}; }
  setParent(parent){ if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this); this.parent=parent; if(parent)parent.children.push(this); }
  addComponent(Type){ return new Type(); } setPosition(x,y,z=0){ this.position={x,y,z}; } setRotationFromEuler(){}
  setScale(x,y,z){ this.scale={x,y,z}; } setSiblingIndex(){}
  destroy(){ this.isValid=false; for(const child of [...this.children])child.destroy(); this.children=[]; }
}
export class UITransform { setContentSize(){} } export class Sprite { static SizeMode={CUSTOM:1}; }
export class Vec3 { constructor(x,y,z){Object.assign(this,{x,y,z});} }
export class SpriteFrame {} export class Rect {} export class Texture2D {
  constructor(){ this.width=16; this.height=16; } set image(value){ this.width=value.width; this.height=value.height; } destroy(){}
}
export class ImageAsset {} export const Layers={Enum:{UI_2D:1}}; export const Color={WHITE:{}};
export const pendingRemoteLoads=[];
export const assetManager={loadRemote(url,callback){ pendingRemoteLoads.push({url,callback}); }};
export function resolveNextRemote(){ const request=pendingRemoteLoads.shift(); if(!request)throw new Error('no pending remote load'); request.callback(null,{width:16,height:16}); }
`);
  const compiler = resolve(root, 'web-prototype/node_modules/typescript/bin/tsc');
  const outputDir = resolve(scratch, 'compiled');
  await execFile(process.execPath, [compiler, '--ignoreConfig', '--noCheck', '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', '--rewriteRelativeImportExtensions', '--outDir', outputDir,
    resolve(root, 'cocos-client/assets/scripts/game/RecoveredAnimation.ts'),
    resolve(root, 'cocos-client/assets/scripts/game/RecoveredTimeline.ts')]);
  const [{ RecoveredAnimation }, { Node, pendingRemoteLoads, resolveNextRemote }] = await Promise.all([
    import(pathToFileURL(resolve(outputDir, 'RecoveredAnimation.js')).href),
    import(pathToFileURL(resolve(packageDir, 'index.js')).href),
  ]);
  const timeline = (id, frames, fps, controls = []) => ({ id, container_path: 'mock.swf', character_id: frames,
    declared_frames: frames, show_frame_count: frames, fps, controls });
  const runtimeCatalog = {
    scopes: { main: { monsterModels: {}, actorModels: {} } }, assets: {
      asyncFrame0: { id: 'asyncFrame0', path: 'async-0.png' },
      asyncFrame1: { id: 'asyncFrame1', path: 'async-1.png' },
    },
    timelines: { stand: timeline('stand', 2, 5), weaponStand: timeline('weaponStand', 3, 5),
      atk: timeline('atk', 4, 10), walk: timeline('walk', 3, 6), asyncStand: timeline('asyncStand', 1, 2),
      asyncAtk: timeline('asyncAtk', 2, 2, [
        { op: 'place', depth: 1, frame: 1, asset_id: 'asyncFrame0', matrix: identity },
        { op: 'place', depth: 1, frame: 2, asset_id: 'asyncFrame1', matrix: identity },
      ]) },
    models: { actor: { id: 'actor', name: 'actor',
      raw: { width: 250, height: 260, anchor: '100,100', mount: '-3,-9', scale: 0.65 }, statuses: [
      { raw: { name: 'stand', dir: 'east', loop: '1', framerate: 5 }, timeline_id: 'stand' },
      { raw: { name: 'walk', dir: 'east', loop: '1', framerate: 6 }, timeline_id: 'walk' },
      { raw: { name: 'atk', dir: 'east', loop: '0', framerate: 10, attack: '3,4,0,0' }, timeline_id: 'atk' },
    ] }, weapon: { id: 'weapon', name: 'weapon', raw: {}, statuses: [
      { raw: { name: 'stand', dir: 'east', loop: '1', framerate: 5 }, timeline_id: 'weaponStand' },
    ] }, asyncActor: { id: 'asyncActor', name: 'asyncActor', raw: {}, statuses: [
      { raw: { name: 'stand', dir: 'east', loop: '1', framerate: 2 }, timeline_id: 'asyncStand' },
      { raw: { name: 'atk', dir: 'east', loop: '0', framerate: 2, attack: '2,0,0,0' }, timeline_id: 'asyncAtk' },
    ] } },
  };
  const animation = new RecoveredAnimation(new Node('host'), runtimeCatalog, 'mock://');
  await animation.setModels(['actor']);
  let oldCue = 0;
  let oldComplete = 0;
  const old = animation.play('atk', 'west', () => oldCue++, () => oldComplete++);
  assert.equal(old.hasNativeState, true);
  assert.equal(old.durationSeconds, 0.4);
  assert.equal(old.cueSeconds, 0.2);
  const westRenderer = animation.node.children.find(child => child.name === 'RecoveredRenderer');
  assert.equal(animation.node.scale.x, 1, 'the logical host must remain unmirrored');
  assert.deepEqual(westRenderer.position, { x: 100, y: 100, z: 0 },
    'west fallback uses raw wanchor plus the source width-scale mirror compensation');
  assert.deepEqual(westRenderer.scale, { x: -0.65, y: 0.65, z: 1 },
    'direction fallback mirrors the common source renderer');
  assert.deepEqual(animation.mountNode.position, { x: 3, y: 9, z: 0 },
    'mount stays relative to the logical position and does not inherit anchor or scale');
  const replacement = animation.play('atk', 'east');
  await old.completion;
  for (let frame = 0; frame < 4; frame++) animation.update(0.1);
  await replacement.completion;
  assert.equal(oldCue, 0, 'a replaced action must not fire its stale cue');
  assert.equal(oldComplete, 0, 'a replaced action must not fire its stale completion callback');
  assert.ok(replacement.generation > old.generation);
  let standAfterComplete;
  const finishing = animation.play('atk', 'east', undefined, () => {
    standAfterComplete = animation.play('stand', 'east');
  });
  for (let frame = 0; frame < 4; frame++) animation.update(0.1);
  await finishing.completion;
  assert.ok(standAfterComplete?.hasNativeState, 'completion may safely begin the next action');
  let standResolved = false;
  standAfterComplete.completion.then(() => { standResolved = true; });
  await Promise.resolve();
  assert.equal(standResolved, false, 'the completed action must not resolve its replacement handle');
  runtimeCatalog.models.actor.statuses[2].raw.attack = '1,4,0,0';
  let walkFromCue;
  const immediateCue = animation.play('atk', 'east', () => {
    walkFromCue = animation.play('walk', 'east');
  });
  await immediateCue.completion;
  assert.ok(walkFromCue?.hasNativeState, 'a frame-one cue may safely replace its own action');
  let walkResolved = false;
  walkFromCue.completion.then(() => { walkResolved = true; });
  await Promise.resolve();
  assert.equal(walkResolved, false, 'the frame-one action must not steal its replacement Promise');
  const reusedBeforeLoop = animation.getPerformanceStats().frameTreesReused;
  const loopingStand = animation.play('stand', 'east');
  const standFrameZero = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid);
  animation.update(0.2);
  const standFrameOne = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  assert.notEqual(standFrameOne, standFrameZero, 'the next source frame gets its own retained display tree');
  animation.update(0.2);
  const reusedFrameZero = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  assert.equal(reusedFrameZero, standFrameZero, 'a looping pose must reuse its retained display tree');
  assert.equal(animation.getPerformanceStats().frameTreesReused, reusedBeforeLoop + 1);
  loopingStand.cancel();
  await animation.setModels(['actor', 'weapon']);
  animation.play('stand', 'east');
  const layeredFrameZero = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  animation.update(0.2);
  animation.update(0.2);
  const rootLoopWithLaterLayer = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  assert.notEqual(rootLoopWithLaterLayer, layeredFrameZero,
    'a root loop must not freeze a longer synchronized layer at its first frame');
  for (let frame = 0; frame < 4; frame++) animation.update(0.2);
  assert.equal(animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false), layeredFrameZero,
    'the composite root/layer pose is reused only when both frame clocks repeat');
  await animation.setModels(['asyncActor'], true);
  animation.play('stand', 'east');
  const previousReadyTree = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  animation.play('atk', 'east');
  assert.equal(pendingRemoteLoads.length, 1);
  assert.equal(previousReadyTree.active, true, 'an action handoff keeps the last complete tree visible while its first texture is pending');
  assert.equal(animation.getPerformanceStats().activeFrameTrees, 1);
  resolveNextRemote();
  await new Promise(resolve => setImmediate(resolve));
  const asyncFrameZero = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  assert.notEqual(asyncFrameZero, previousReadyTree, 'the prepared first action frame replaces the handoff tree after loading');
  animation.update(0.5);
  assert.equal(pendingRemoteLoads.length, 1);
  assert.equal(asyncFrameZero.active, true, 'a pending next frame must not hide the current complete frame');
  assert.equal(animation.getPerformanceStats().pendingFrameTrees, 1);
  animation.play('stand', 'east');
  const replacementStand = animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false);
  resolveNextRemote();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(animation.node.children.find(child => child.name === 'RecoveredRenderer' && child.isValid && child.active !== false), replacementStand,
    'a stale texture completion must not roll back a newer action');
  assert.ok(animation.getPerformanceStats().retainedFrameTrees <= 49, 'frame trees remain bounded during atomic handoff');
  const missingHit = animation.play('hit', 'east');
  assert.equal(missingHit.hasNativeState, false);
  assert.equal(missingHit.statusName, null);
  await missingHit.completion;
  const missingDeath = animation.play('die', 'east');
  assert.equal(missingDeath.hasNativeState, false);
  assert.deepEqual(animation.node.children.filter(child => child.isValid).map(child => child.name), ['RecoveredMount'],
    'missing death keeps only the mount and does not show stand');
  animation.destroy();
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log('Recovered animation timeline/lifecycle regression PASS (mock runtime; not visual acceptance)');
