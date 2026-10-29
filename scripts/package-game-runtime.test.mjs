import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRuntimePlan, materializeRuntime, safeRelative } from './package-game-runtime.mjs';

test('runtime paths reject traversal and platform-specific escapes', () => {
  for (const value of ['../secret', 'files/../../secret', '/absolute', 'windows\\secret']) {
    assert.throws(() => safeRelative(value), /escapes|Invalid/);
  }
  assert.equal(safeRelative('backend/game/server.mjs'), 'backend/game/server.mjs');
});

test('small runtime fixture is copied and manifested without overwriting output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tianxu-package-test-'));
  try {
    const source = path.join(root, 'source');
    const output = path.join(root, 'runtime');
    await mkdir(path.join(source, 'backend/game'), { recursive: true });
    const filename = path.join(source, 'backend/game/server.mjs');
    await writeFile(filename, 'export const ready = true;\n');
    const plan = { files: [{ relative: 'backend/game/server.mjs', filename, size: 27 }] };
    await materializeRuntime(plan, output);
    assert.equal(await readFile(path.join(output, 'backend/game/server.mjs'), 'utf8'), 'export const ready = true;\n');
    const manifest = JSON.parse(await readFile(path.join(output, 'runtime-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.map(file => file.path), ['backend/game/server.mjs', 'package.json']);
    await assert.rejects(() => materializeRuntime(plan, output), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release planning rejects diagnostic files and compiled rig experiment code', async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'tianxu-release-boundary-')));
 try{
  await mkdir(path.join(root,'backend'),{recursive:true});await mkdir(path.join(root,'web'),{recursive:true});
  await writeFile(path.join(root,'policy.json'),JSON.stringify({version:1,fixedFiles:[],backend:{directory:'backend',extension:'.mjs',excludeSuffix:'.test.mjs'},web:{directory:'web',requiredEntry:'index.html'}}));
  for(const source of ['<script src="art-observe.js"></script>','System.register("SharedRigAnimation")','rigbench=1']){
   await writeFile(path.join(root,'web/index.html'),source);await assert.rejects(()=>buildRuntimePlan(root,'policy.json'),/Experimental build/);
  }
  await writeFile(path.join(root,'web/index.html'),'ordinary game');await writeFile(path.join(root,'web/art-record.js'),'');
  await assert.rejects(()=>buildRuntimePlan(root,'policy.json'),/Local diagnostics/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('explicit current frontend is packaged under the normal runtime path without changing old build',async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'tianxu-current-web-')));
 try{
  for(const dir of ['backend','web','current-web','content','ui'])await mkdir(path.join(root,dir));
  await writeFile(path.join(root,'web/index.html'),'old build');await writeFile(path.join(root,'current-web/index.html'),'current native build');
  await writeFile(path.join(root,'content/catalog.json'),'{}');
  await writeFile(path.join(root,'policy.json'),JSON.stringify({version:1,fixedFiles:[],backend:{directory:'backend',extension:'.mjs',excludeSuffix:'.test.mjs'},web:{directory:'web',requiredEntry:'index.html'},content:{directory:'content',catalog:'catalog.json',metadata:[],tableScope:'main:',assetScope:'main'},localization:{directory:'localization',files:[]},ui:{directory:'ui'}}));
  const plan=await buildRuntimePlan(root,'policy.json',{webDirectory:'current-web'});const out=path.join(root,'out');await materializeRuntime(plan,out);
  assert.equal(await readFile(path.join(out,'web/index.html'),'utf8'),'current native build');
  assert.equal(await readFile(path.join(root,'web/index.html'),'utf8'),'old build');
  assert.ok(!plan.files.some(f=>f.relative.startsWith('current-web/')));
  await assert.rejects(()=>buildRuntimePlan(root,'policy.json',{webDirectory:'../outside'}),/escapes/);
 }finally{await rm(root,{recursive:true,force:true});}
});
