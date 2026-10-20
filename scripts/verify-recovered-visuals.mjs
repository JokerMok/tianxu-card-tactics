#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const recovered = resolve(root, 'cocos-client/assets/resources/recovered');
const catalog = JSON.parse(await readFile(resolve(recovered, 'catalog.json'), 'utf8'));
const execFile = promisify(execFileCallback);

assert.equal(catalog.sourceManifest, '5254333315581813739');
assert.ok(Object.keys(catalog.scopes.main.monsterModels).length > 8_000);

const validSummonCards = Object.values(catalog.scopes.main.cards).filter(card =>
  Number(card.raw?.Type) === 1 && Number(card.raw?.MonsterID) > 0 && !/废弃/.test(String(card.raw?.Name ?? '')));
assert.equal(validSummonCards.length, 6_289, 'valid main summon-card count changed');
assert.equal(validSummonCards.filter(card => card.sourceModelResolution === 'unmatched').length, 37,
  'source extractor model-gap evidence changed');
assert.equal(validSummonCards.filter(card => card.modelResolution === 'unmatched').length, 0,
  'runtime summon-card model links remain unresolved');
const summonArtPaths = new Set();
for (const card of validSummonCards) {
  assert.equal(card.artResolution, 'matched', `${card.id} lacks matched card art`);
  assert.ok(card.art.length > 0, `${card.id} lacks card art references`);
  for (const assetId of card.art) {
    const asset = catalog.assets[assetId];
    assert.ok(asset?.path, `${card.id} refers to unavailable art ${assetId}`);
    summonArtPaths.add(resolve(recovered, asset.path));
  }
  const monsterId = String(card.raw.MonsterID);
  const link = catalog.scopes.main.monsterModels[monsterId];
  assert.ok(link?.modelId, `${card.id} lacks a runtime monster-model link`);
  assert.deepEqual(card.models, [link.modelId], `${card.id} card/runtime model links diverge`);
  assert.equal(card.modelResolution, link.resolution, `${card.id} card/runtime model resolution diverges`);
  const model = catalog.models[link.modelId];
  assert.ok(model, `${card.id} refers to missing model ${link.modelId}`);
  const playable = model.statuses.filter(status => status.timeline_id && catalog.timelines[status.timeline_id]);
  assert.ok(playable.length > 0, `${card.id} model ${model.name} has no playable timeline`);
  assert.ok(playable.some(status => ['stand', 'std', 'idle'].includes(String(status.raw?.name ?? '').toLowerCase())),
    `${card.id} model ${model.name} has no standing timeline`);
}
await Promise.all([...summonArtPaths].map(filename => access(filename)));

const childByCharacter = new Map(Object.values(catalog.timelines).map(timeline =>
  [`${timeline.container_path}:${timeline.character_id}`, timeline]));

function bitmapLeaves(timelineId, seen = new Set()) {
  if (!timelineId || seen.has(timelineId)) return [];
  seen.add(timelineId);
  const timeline = catalog.timelines[timelineId];
  assert.ok(timeline, `missing timeline ${timelineId}`);
  const leaves = [];
  for (const operation of timeline.controls) {
    if (!operation.asset_id) continue;
    const asset = catalog.assets[operation.asset_id];
    assert.ok(asset, `missing asset ${operation.asset_id}`);
    const child = childByCharacter.get(`${timeline.container_path}:${operation.character_id}`);
    if (child) leaves.push(...bitmapLeaves(child.id, seen));
    else if (asset.path) leaves.push(asset);
    else for (const fill of asset.fillStyles ?? []) {
      if (!fill.bitmap_asset_id) continue;
      const bitmap = catalog.assets[fill.bitmap_asset_id];
      assert.ok(bitmap?.path, `shape ${asset.id} has no imported bitmap dependency`);
      leaves.push(bitmap);
    }
  }
  return leaves;
}

const candidates = [];
const modelNames = new Set();
const modelContainers = new Set();
for (const [monsterId, link] of Object.entries(catalog.scopes.main.monsterModels)) {
  if (!link.modelId || modelNames.has(link.modelName)) continue;
  const model = catalog.models[link.modelId];
  if (!model) continue;
  if (modelContainers.has(model.raw.swf)) continue;
  const statuses = Object.fromEntries(model.statuses.map(status => [status.raw.name, status]));
  if (!statuses.stand?.timeline_id || !statuses.walk?.timeline_id || !statuses.atk?.timeline_id) continue;
  if ([statuses.stand, statuses.walk, statuses.atk].some(status =>
    (catalog.timelines[status.timeline_id]?.show_frame_count ?? 0) < 2)) continue;
  candidates.push({ monsterId, link, model, statuses });
  modelNames.add(link.modelName);
  modelContainers.add(model.raw.swf);
  if (candidates.length === 3) break;
}
assert.equal(candidates.length, 3, 'need three distinct animated main monsters');

const firstFrameHashes = new Set();
const evidence = [];
for (const candidate of candidates) {
  const result = { monsterId: candidate.monsterId, model: candidate.model.name, statuses: {} };
  for (const name of ['stand', 'walk', 'atk']) {
    const status = candidate.statuses[name];
    const timeline = catalog.timelines[status.timeline_id];
    const leaves = bitmapLeaves(status.timeline_id);
    assert.ok(leaves.length >= timeline.show_frame_count,
      `${candidate.model.name}:${name} has incomplete bitmap-backed frames`);
    await Promise.all(leaves.map(asset => access(resolve(recovered, asset.path))));
    const fps = Number(status.raw.framerate);
    assert.ok(fps > 0);
    result.statuses[name] = {
      frames: timeline.show_frame_count,
      fps,
      durationSeconds: timeline.show_frame_count / fps,
      bitmapLeaves: leaves.length,
    };
    if (name === 'stand') firstFrameHashes.add(leaves[0].sourceHash);
  }
  const cue = Number(String(candidate.statuses.atk.raw.attack ?? '').split(',')[0]);
  assert.ok(cue >= 1 && cue <= result.statuses.atk.frames,
    `${candidate.model.name} attack cue is outside its animation`);
  result.attackCueFrame = cue;
  evidence.push(result);
}
assert.equal(firstFrameHashes.size, candidates.length, 'sample monsters must use distinct source art');

const actorEvidence = [];
const actorStandHashes = new Set();
for (const profession of [1, 2, 3, 4]) {
  for (const sex of [0, 1]) {
    const link = catalog.scopes.main.actorModels[`${profession}:${sex}`];
    assert.equal(link?.resolution, 'actor_xml_exact');
    assert.equal(link.modelIds.length, 2, 'default actor must have body and weapon layers');
    const layers = [];
    for (const modelId of link.modelIds) {
      const model = catalog.models[modelId];
      assert.ok(model, `missing actor model ${modelId}`);
      const states = Object.fromEntries(model.statuses.map(status => [status.raw.name, status]));
      for (const name of ['stand', 'walk', 'atk']) {
        assert.ok(states[name]?.timeline_id, `${model.name} lacks ${name}`);
        const leaves = bitmapLeaves(states[name].timeline_id);
        assert.ok(leaves.length >= 2, `${model.name}:${name} is not a real multi-frame layer`);
        await Promise.all(leaves.map(asset => access(resolve(recovered, asset.path))));
        if (name === 'stand' && layers.length === 0) actorStandHashes.add(leaves[0].sourceHash);
      }
      layers.push(model.name);
    }
    actorEvidence.push({ profession, sex, layers });
  }
}
assert.equal(actorStandHashes.size, 8, 'profession/sex actor bodies must use distinct source art');

const skillEffectEvidence = [];
for (const [skillId, skill] of Object.entries(catalog.scopes.main.skills)) {
  for (const modelId of skill.visualModels ?? []) {
    const model = catalog.models[modelId];
    assert.ok(model, `skill ${skillId} refers to missing model ${modelId}`);
    const playable = model.statuses.filter(status => status.timeline_id && catalog.timelines[status.timeline_id]);
    const standing = playable.filter(status => ['stand', 'std', 'idle']
      .includes(String(status.raw.name ?? '').toLowerCase()));
    const status = standing[0] ?? playable[0];
    if (!status) continue;
    const timeline = catalog.timelines[status.timeline_id];
    const frames = Number(timeline.show_frame_count || timeline.declared_frames);
    const fps = Number(status.particle_framerate || status.raw.framerate || timeline.fps);
    if (frames < 2 || fps <= 0) continue; // one source frame is a visual, not animation evidence
    const leaves = bitmapLeaves(status.timeline_id);
    assert.ok(leaves.length > 0, `${skillId}:${model.name} has no bitmap-backed effect frames`);
    await Promise.all(leaves.map(asset => access(resolve(recovered, asset.path))));
    assert.ok(timeline.controls.some(control => control.matrix),
      `${skillId}:${model.name} lacks recovered local matrices`);
    const offsetX = Number(status.raw.offsetx ?? 0);
    const offsetY = Number(status.raw.offsety ?? 0);
    assert.ok(Number.isFinite(offsetX) && Number.isFinite(offsetY));
    skillEffectEvidence.push({ skillId, modelId, model: model.name,
      status: status.raw.name, frames, fps, durationSeconds: frames / fps,
      offset: [offsetX, offsetY], container: status.particle_source?.container,
      symbol: status.particle_source?.symbol, bitmapLeaves: leaves.length });
    break;
  }
  if (skillEffectEvidence.length === 3) break;
}
assert.equal(skillEffectEvidence.length, 3, 'need three real multi-frame skill visualModels');

// Execute the renderer's actual one-shot completion path with a minimal Cocos
// surface. This checks that every sampled effect completes after its source
// frame count and can be released by RecoveredEffects without a browser.
const scratch = await mkdtemp(resolve(tmpdir(), 'recovered-animation-'));
try {
  const packageDir = resolve(scratch, 'node_modules/cc');
  await writeFile(resolve(scratch, 'package.json'), '{"type":"module"}');
  await mkdir(packageDir, { recursive: true });
  await writeFile(resolve(packageDir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await writeFile(resolve(packageDir, 'index.js'), `
export class Node {
  constructor(name=''){ this.name=name; this.children=[]; this.isValid=true; }
  setParent(parent){ if(this.parent) this.parent.children=this.parent.children.filter(x=>x!==this); this.parent=parent; if(parent) parent.children.push(this); }
  addComponent(Type){ return new Type(); } setPosition(){} setScale(){} setRotationFromEuler(){}
  setSiblingIndex(){} destroy(){ this.isValid=false; for(const child of [...this.children]) child.destroy(); this.children=[]; }
}
export class UITransform { setContentSize(){} }
export class Sprite { static SizeMode={CUSTOM:1}; }
export class SpriteFrame {} export class Rect { constructor(...args){ this.args=args; } }
export class Texture2D { constructor(){ this.width=64; this.height=64; } destroy(){} }
export class ImageAsset {} export const Layers={Enum:{UI_2D:1}}; export const Color={WHITE:{}};
export const assetManager={loadRemote(url,callback){ callback(null,{width:64,height:64}); }};
`);
  const compiler = resolve(root, 'web-prototype/node_modules/typescript/bin/tsc');
  const outputDir = resolve(scratch, 'compiled');
  await execFile(process.execPath, [compiler, '--noCheck', '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', '--rewriteRelativeImportExtensions', '--outDir', outputDir,
    resolve(root, 'cocos-client/assets/scripts/game/RecoveredAnimation.ts')]);
  const modulePath = resolve(outputDir, 'RecoveredAnimation.js');
  const [{ RecoveredAnimation }, { Node }] = await Promise.all([
    import(pathToFileURL(modulePath).href),
    import(pathToFileURL(resolve(packageDir, 'index.js')).href),
  ]);
  for (const sample of skillEffectEvidence) {
    const animation = new RecoveredAnimation(new Node('host'), catalog, 'mock://recovered');
    await animation.setModels([sample.modelId]);
    let completions = 0;
    const playback = animation.playOneShot('east', () => completions++);
    assert.ok(playback);
    assert.equal(playback.statusName, sample.status);
    assert.equal(playback.durationSeconds, sample.durationSeconds);
    for (let frame = 0; frame < sample.frames; frame++) animation.update(1 / sample.fps);
    assert.equal(completions, 1, `${sample.model} did not complete after its source frame duration`);
    animation.update(1 / sample.fps);
    assert.equal(completions, 1, `${sample.model} completed more than once`);
    animation.destroy();
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const rendererSource = resolve(root, 'cocos-client/assets/scripts/game/RecoveredAnimation.ts');
const builtBundle = resolve(root, '.local/web/assets/main/index.js');
const [rendererStat, bundleStat, bundleSource] = await Promise.all([
  stat(rendererSource), stat(builtBundle), readFile(builtBundle, 'utf8'),
]);
assert.ok(bundleStat.mtimeMs >= rendererStat.mtimeMs,
  'Cocos web bundle predates RecoveredAnimation.ts; rebuild before visual verification');
assert.ok(!bundleSource.includes('[].concat(this.evaluate(timeline, frame))'),
  'Cocos bundle contains the Map-spread transform that breaks recovered display lists');
assert.ok(bundleSource.includes('Array.from(this.evaluate(timeline, frame))'),
  'Cocos bundle does not contain the build-safe recovered display-list iteration');

console.log(JSON.stringify({
  ok: true,
  sourceManifest: catalog.sourceManifest,
  sampledMonsters: evidence,
  actorModels: actorEvidence,
  sampledSkillEffects: skillEffectEvidence,
  builtBundle: '.local/web/assets/main/index.js',
  importedBitmapFiles: Object.values(catalog.assets).filter(asset => asset.path).length,
  descriptorAssets: Object.values(catalog.assets).filter(asset => asset.fileStatus === 'descriptor_only').length,
}, null, 2));
