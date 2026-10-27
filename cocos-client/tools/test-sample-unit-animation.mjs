#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..', '..');
const scratch = await mkdtemp(resolve(tmpdir(), 'sample-unit-animation-'));
const execFile = promisify(execFileCallback);

try {
  const packageDir = resolve(scratch, 'node_modules/cc');
  await mkdir(packageDir, { recursive: true });
  await writeFile(resolve(scratch, 'package.json'), '{"type":"module"}');
  await writeFile(resolve(packageDir, 'package.json'), '{"type":"module","exports":"./index.js"}');
  await writeFile(resolve(packageDir, 'index.js'), `
export class Node {
  constructor(name=''){this.name=name;this.children=[];this.active=true;this.isValid=true;this.scale={x:1,y:1,z:1};this.position={x:0,y:0,z:0};}
  setParent(parent){this.parent=parent;if(parent)parent.children.push(this);}
  addComponent(Type){const value=new Type();this.component=value;return value;}
  setScale(x,y,z){this.scale={x,y,z};} setPosition(x,y,z){this.position={x,y,z};}
  destroy(){this.isValid=false;for(const child of this.children)child.destroy();}
}
export class UITransform {setContentSize(w,h){this.size={w,h};}setAnchorPoint(x,y){this.anchorPoint={x,y};}}
export class Sprite {static SizeMode={CUSTOM:1};constructor(){this.spriteFrame=null;}}
export class Size {constructor(width,height){this.width=width;this.height=height;}}
export class Rect {constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}
export class SpriteFrame {constructor(){this.isValid=true;}destroy(){this.isValid=false;metrics.framesDestroyed++;}}
export class Texture2D {constructor(){this.isValid=true;}set image(value){this.width=value.width;this.height=value.height;}destroy(){this.isValid=false;metrics.texturesDestroyed++;}}
export class ImageAsset {}
export const Layers={Enum:{UI_2D:1}};
export const pending=[];
export const metrics={loads:0,releasedImages:0,framesDestroyed:0,texturesDestroyed:0};
export const assetManager={
  loadRemote(url,options,callback){metrics.loads++;pending.push({url,callback});},
  releaseAsset(){metrics.releasedImages++;},
};
export function resolveNext(width=2304,height=1536){const request=pending.shift();request.callback(null,{width,height});}
export function rejectNext(){const request=pending.shift();request.callback(new Error('mock failure'));}
`);

  const compiler = resolve(root, 'web-prototype/node_modules/typescript/bin/tsc');
  const outputDir = resolve(scratch, 'compiled');
  if (existsSync(compiler)) {
    await execFile(process.execPath, [compiler, '--ignoreConfig', '--noCheck', '--target', 'es2022', '--module', 'esnext',
      '--moduleResolution', 'bundler', '--rewriteRelativeImportExtensions', '--outDir', outputDir,
      resolve(root, 'cocos-client/assets/scripts/game/SampleUnitAnimation.ts')]);
  } else {
    // Current local Node supports TS transformation; a mock-only test need not install a compiler.
    await mkdir(outputDir, {recursive:true});
    await writeFile(resolve(outputDir, 'SampleUnitAnimation.js'), stripTypeScriptTypes(
      await readFile(resolve(root, 'cocos-client/assets/scripts/game/SampleUnitAnimation.ts'), 'utf8'), {mode:'transform'}));
  }
  const [{ SampleUnitAnimation }, cc] = await Promise.all([
    import(pathToFileURL(resolve(outputDir, 'SampleUnitAnimation.js')).href),
    import(pathToFileURL(resolve(packageDir, 'index.js')).href),
  ]);
  const spec = {
    atlas: 'guard.png', frameSize: [256, 256], columns: 9, frameCount: 54,
    displaySize: [170, 170], foot: [128, 220], mount: [170, 100], nameOffsetY: 74,
    clips: {
      stand: { start: 0, count: 8, fps: 12, loop: true },
      walk: { start: 8, count: 12, fps: 16, loop: true },
      atk: { start: 20, count: 12, fps: 20, loop: false, cueFrame: 5 },
      hit: { start: 32, count: 6, fps: 20, loop: false },
      die: { start: 38, count: 16, fps: 20, loop: false },
    },
  };

  const host = new cc.Node('host');
  const first = new SampleUnitAnimation(host, 'mock://samples', spec);
  const second = new SampleUnitAnimation(host, 'mock://samples', spec);
  const firstLoad = first.load();
  const secondLoad = second.load();
  assert.equal(cc.metrics.loads, 1, 'two instances share one pending atlas request');
  assert.equal(first.spriteNode.active, false, 'the sprite stays hidden until the whole frame bank is ready');
  cc.resolveNext();
  await Promise.all([firstLoad, secondLoad]);
  assert.deepEqual(first.getPerformanceStats(), {
    atlasPoolEntries: 1, atlasPoolPendingEntries: 0, atlasPoolLiveReferences: 2, atlasPoolSpriteFrames: 54,
    atlasPoolEstimatedBytes: 9 * 256 * 6 * 256 * 4,
    atlasPoolMaxEntries: 19, atlasPoolMaxEstimatedBytes: 128 * 1024 * 1024,
    instanceLoaded: true, instancePlaying: false, instanceFrame: -1, playbackElapsedSeconds: 0,
    plays: 0, frameChanges: 0, cues: 0, completions: 0, cancellations: 0,
  });

  let cues = 0;
  let completions = 0;
  const attack = first.play('atk', 'west', () => cues++, () => completions++);
  assert.equal(attack.cueSeconds, 0.25);
  assert.equal(attack.durationSeconds, 0.6);
  assert.equal(first.getSourceLayoutMetrics().nameOffsetY, 74, 'name height must not use transparent atlas padding');
  assert.equal(first.spriteNode.scale.x, -1, 'west mirrors the sprite around its foot pivot');
  assert.equal(first.mountNode.position.x, -((170 - 128) * 170 / 256));
  first.update(0.24);
  assert.equal(cues, 0);
  first.update(0.02);
  assert.equal(cues, 1, 'a cue fires when a time step crosses its frame');
  first.update(1);
  await attack.completion;
  first.update(1);
  assert.equal(cues, 1);
  assert.equal(completions, 1, 'a non-loop completion callback fires once');

  let staleCue = 0;
  let staleComplete = 0;
  const stale = first.play('atk', 'east', () => staleCue++, () => staleComplete++);
  const stand = first.play('stand', 'east');
  await stale.completion;
  first.update(1);
  assert.equal(staleCue, 0);
  assert.equal(staleComplete, 0, 'replacement suppresses stale callbacks');
  let standResolved = false;
  stand.completion.then(() => { standResolved = true; });
  await Promise.resolve();
  assert.equal(standResolved, false, 'a loop remains active until cancellation');
  stand.cancel();
  await stand.completion;

  assert.equal(first.playBlock('east'),null,'legacy packs without a block pose do not fake an injury');
  spec.reactions={block:{start:32,count:3,fps:15,loop:false}};
  const block=first.playBlock('west');
  assert.equal(block.statusName,'block');assert.equal(block.cueSeconds,null);
  assert.equal(block.durationSeconds,.2);first.update(.21);await block.completion;
  assert.equal(cues,1,'shield brace cannot repeat an attack cue');
  first.destroy();
  assert.equal(second.getPerformanceStats().atlasPoolLiveReferences, 1);
  assert.equal(cc.metrics.framesDestroyed, 0);
  second.destroy();
  assert.equal(cc.metrics.framesDestroyed, 54);
  assert.equal(cc.metrics.texturesDestroyed, 1);
  assert.equal(cc.metrics.releasedImages, 1);

  const pending = new SampleUnitAnimation(host, 'mock://pending', spec);
  const pendingLoad = pending.load();
  pending.destroy();
  cc.resolveNext();
  await assert.rejects(pendingLoad, /destroyed/);
  assert.equal(pending.getPerformanceStats().atlasPoolEntries, 0, 'a destroyed pending instance leaves no pool entry');
  assert.equal(cc.metrics.framesDestroyed, 54, 'an abandoned pending load never creates frame objects');
  assert.equal(cc.metrics.releasedImages, 2);

  const failed = new SampleUnitAnimation(host, 'mock://failed', spec);
  const failedLoad = failed.load();
  cc.rejectNext();
  await assert.rejects(failedLoad, /Unable to load sample atlas/);
  failed.destroy();
  assert.equal(failed.getPerformanceStats().atlasPoolEntries, 0);

  // Exercise the actual three-unit pack together with the approved six-model
  // chapter batch shape (five 1536x1280 and one 1920x1600 RGBA atlases).
  const pack=JSON.parse(await readFile(resolve(root,'cocos-client/assets/resources/art-samples/v3/manifest.json'),'utf8'));
  assert.deepEqual(Object.keys(pack.units).sort(),['main:monster:1','main:monster:19','main:monster:43']);
  const instances=[];const frameBase=cc.metrics.framesDestroyed;
  for(const id of [1,19,43]) {
    const actual=pack.units['main:monster:'+id];
    const pair=[new SampleUnitAnimation(host,'mock://batch2',actual),new SampleUnitAnimation(host,'mock://batch2',actual)];
    const loads=pair.map(x=>x.load());
    cc.resolveNext(actual.columns*actual.frameSize[0],Math.ceil(actual.frameCount/actual.columns)*actual.frameSize[1]);
    await Promise.all(loads);instances.push(...pair);
    let impacts=0;const attack=pair[0].play('atk','west',()=>impacts++);
    const expected=id===43?.375:.25;assert.equal(attack.cueSeconds,expected);
    pair[0].update(expected-.001);assert.equal(impacts,0);
    pair[0].update(.002);assert.equal(impacts,1);
    pair[0].update(2);await attack.completion;assert.equal(impacts,1);
    if(id!==1)assert.equal(pair[0].playBlock('west'),null,'do not invent shield blocking');
  }
  const chapterPack=JSON.parse(await readFile(resolve(root,'cocos-client/assets/resources/art-samples/v4/manifest.json'),'utf8'));
  for(const id of [61,5019,60001,60002,60003,60005]){
    const candidate=chapterPack.units['main:monster:'+id];
    const animation=new SampleUnitAnimation(host,'mock://chapter1',candidate);
    const loading=animation.load();
    cc.resolveNext(candidate.columns*candidate.frameSize[0],Math.ceil(candidate.frameCount/candidate.columns)*candidate.frameSize[1]);
    await loading;instances.push(animation);
    let impacts=0;const attack=animation.play('atk','west',()=>impacts++);
    const expected=id===5019?.375:.25;assert.equal(attack.cueSeconds,expected);
    animation.update(expected-.001);assert.equal(impacts,0);
    animation.update(.002);assert.equal(impacts,1);
    animation.update(2);await attack.completion;assert.equal(impacts,1);
    assert.equal(animation.playBlock('east'),null,'new units do not invent a block reaction');
  }
  const chapterStats=instances[0].getPerformanceStats();
  assert.equal(chapterStats.atlasPoolEntries,9);
  assert.equal(chapterStats.atlasPoolLiveReferences,12);
  assert.equal(chapterStats.atlasPoolSpriteFrames,275);
  assert.equal(chapterStats.atlasPoolEstimatedBytes,77.4375*1024*1024,
    'three actual v3 atlases plus the six-model chapter batch fit below the explicit 80 MiB budget');
  const shared=new SampleUnitAnimation(host,'mock://chapter1',chapterPack.units['main:monster:61']);
  await shared.load();instances.push(shared);
  assert.equal(shared.getPerformanceStats().atlasPoolEntries,9,'same-model instances share one atlas');
  assert.equal(shared.getPerformanceStats().atlasPoolLiveReferences,13);
  for(let index=0;index<10;index++){
    const tiny={...pack.units['main:monster:19'],atlas:`count-${index}.png`,frameSize:[16,16],displaySize:[16,16],foot:[8,14],mount:[8,8]};
    const animation=new SampleUnitAnimation(host,'mock://count-budget',tiny);
    const loading=animation.load();cc.resolveNext(96,80);await loading;instances.push(animation);
  }
  const beforeRejectedAdmission=cc.metrics.framesDestroyed;
  const overflow=new SampleUnitAnimation(host,'mock://chapter1',{...pack.units['main:monster:19'],atlas:'chapter-overflow.png'});
  await assert.rejects(overflow.load(),/active-count budget exceeded/);
  overflow.destroy();
  assert.equal(cc.metrics.framesDestroyed,beforeRejectedAdmission,'admission never evicts a live atlas');
  for(const animation of instances)animation.destroy();
  assert.equal(instances[0].getPerformanceStats().atlasPoolEntries,0);
  assert.equal(cc.metrics.framesDestroyed-frameBase,575,'last release destroys each shared frame bank exactly once');

  // The byte gate is independent from the count gate: ten large atlases fit,
  // while an eleventh crosses 128 MiB with slots still available.
  const large=[];const largeSpec={...pack.units['main:monster:43']};
  for(let index=0;index<10;index++){
    const animation=new SampleUnitAnimation(host,'mock://byte-budget',{...largeSpec,atlas:`large-${index}.png`});
    const loading=animation.load();cc.resolveNext(1920,1600);await loading;large.push(animation);
  }
  const byteOverflow=new SampleUnitAnimation(host,'mock://byte-budget',{...largeSpec,atlas:'large-overflow.png'});
  await assert.rejects(byteOverflow.load(),/active-byte budget exceeded/);
  byteOverflow.destroy();
  assert.equal(large[0].getPerformanceStats().atlasPoolEntries,10);
  assert.equal(large[0].getPerformanceStats().atlasPoolEstimatedBytes,117.1875*1024*1024);
  const underestimated={...pack.units['main:monster:19'],atlas:'underestimated.png',frameSize:[128,128],
    displaySize:[100,100],foot:[64,110],mount:[64,80]};
  const underestimatedAnimation=new SampleUnitAnimation(host,'mock://byte-budget',underestimated);
  const underestimatedLoad=underestimatedAnimation.load();
  cc.resolveNext(1920,1600);
  await assert.rejects(underestimatedLoad,/active-byte budget exceeded/,
    'actual decoded dimensions recheck an atlas that understated its layout footprint');
  underestimatedAnimation.destroy();
  assert.equal(large[0].getPerformanceStats().atlasPoolEntries,10,'a rejected image leaves all active atlases intact');
  large.forEach(animation=>animation.destroy());
  assert.equal(large[0].getPerformanceStats().atlasPoolEntries,0,'idle atlases are released instead of retained as preloads');

  const production=JSON.parse(await readFile(resolve(root,'cocos-client/assets/resources/art-samples/v5/manifest.json'),'utf8'));
  const productionUnits=Object.values(production.units).filter((s,i,a)=>a.findIndex(t=>t.atlas===s.atlas)===i);
  assert.equal(productionUnits.length,19);
  const productionActors=[];
  for(const actual of productionUnits){
    const pair=[new SampleUnitAnimation(host,'mock://production',actual),new SampleUnitAnimation(host,'mock://production',actual)];
    const loads=pair.map(a=>a.load());cc.resolveNext(actual.columns*actual.frameSize[0],Math.ceil(actual.frameCount/actual.columns)*actual.frameSize[1]);await Promise.all(loads);productionActors.push(...pair);
    const attack=pair[0].play('atk','west');pair[0].update(2);await attack.completion;
  }
  assert.equal(SampleUnitAnimation.atlasMetrics().atlasPoolEntries,19);
  assert.equal(SampleUnitAnimation.atlasMetrics().atlasPoolLiveReferences,38);
  assert.ok(SampleUnitAnimation.atlasMetrics().atlasPoolEstimatedBytes<128*1024*1024);
  productionActors.forEach(a=>a.destroy());assert.equal(SampleUnitAnimation.atlasMetrics().atlasPoolEntries,0);
  const residueSpec={atlas:'residue.png',frameSize:[8,8],columns:1,frameCount:1,
    displaySize:[16,16],foot:[4,7],mount:[0,0],requiredStatuses:['stand'],
    clips:{stand:{start:0,count:1,fps:2,loop:true}}};
  const residue=new SampleUnitAnimation(host,'mock://special',residueSpec);
  const residueLoad=residue.load();cc.resolveNext(8,8);await residueLoad;
  const idle=residue.play('stand','west');residue.update(2);
  assert.equal(idle.durationSeconds,.5,'special clip timing comes from its own manifest');
  assert.equal(residue.play('atk','west').hasNativeState,false,'missing residue actions are not fake actor animations');
  residue.destroy();assert.equal(SampleUnitAnimation.atlasMetrics().atlasPoolEntries,0);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log('Sample unit atlas clock/cue/cancel/refcount PASS (mock Cocos runtime; not visual acceptance)');
