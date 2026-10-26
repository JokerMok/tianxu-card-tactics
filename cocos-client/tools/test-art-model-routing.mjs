import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../assets/scripts/game/ArtSkin.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm,''),{mode:'transform'}).replace('export class ArtSkin','class ArtSkin')+'\nreturn ArtSkin;';
const v5=JSON.parse(await readFile(new URL('../assets/resources/art-samples/v5/manifest.json',import.meta.url),'utf8'));
const v4=JSON.parse(await readFile(new URL('../assets/resources/art-samples/v4/manifest.json',import.meta.url),'utf8'));
function skin(search,manifest){return new Function('location','fetch','SampleUnitAnimation',code)({search},async()=>({ok:true,json:async()=>manifest}),{});}
test('stable recovered model identity shares art without changing card/monster IDs or crossing scopes',async()=>{
 const art=skin('?art=unit',v5);await art.load('http://localhost');
 const guard='model:37d68956aa077843b62b';
 assert.equal(art.unit('main',2,guard),art.unit('main',1,guard));
 assert.equal(art.unit('media',2,guard),undefined);
 assert.equal(art.unit('main',9999,'model:uncovered'),undefined);
 assert.equal(art.unit('main',1,'model:uncovered'),v5.units['main:monster:1'],'explicit monster override stays first');
 const sentinel='model:26b078148d1f7af2f252';
 assert.notEqual(art.unit('main',8,sentinel).atlas,art.unit('main',2,guard).atlas,'different equipment model remains independent');
});
test('earlier packs and original switch preserve their exact prior routing',async()=>{
 const old=skin('?art=unit&skin=sample-batch3',v4);await old.load('http://localhost');
 assert.equal(old.unit('main',2,'model:37d68956aa077843b62b'),undefined);
 assert.equal(old.unit('main',1),v4.units['main:monster:1']);
 const original=skin('?skin=original',v5);await original.load('http://localhost');assert.equal(original.unit('main',1),undefined);
});
