import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
let text=stripTypeScriptTypes(readFileSync('cocos-client/assets/scripts/game/OriginalUi.ts','utf8'),{mode:'transform'}).replace(/^import[\s\S]*?from 'cc';\s*/,'').replaceAll('export ','');
const OriginalUi=new Function(text+';return OriginalUi;')();
const pkg='pkg00001',images={},children=[];
for(let i=0;i<10;i++){images[pkg+':im'+i]={id:'im'+i,resourcePath:'im'+i,file:'im'+i+'.png'};children.push({kind:'image',attributes:{src:'im'+i}});}
children.push(children[0],{kind:'list',attributes:{defaultItem:'ui://'+pkg+'unused'},children:[]});
const catalog={version:1,sourceManifest:'5254333315581813739',fairygui:{images,components:{root:{packageId:pkg,children,settings:[]},[pkg+':unused']:{packageId:pkg,children:[{kind:'image',attributes:{src:'missing'}}],settings:[]}}}};
const ui=new OriginalUi(catalog),parent={isValid:true},pending=[],seen=[];let active=0,max=0;
ui.loadFrame=(path)=>{seen.push(path);active++;max=Math.max(max,active);return new Promise(resolve=>pending.push(()=>{active--;resolve({});}));};
const done=ui.prepareComponentFrames('root',parent);assert.equal(pending.length,6);
while(pending.length){pending.shift()();for(let i=0;i<5;i++)await Promise.resolve();}await done;
assert.equal(max,6);assert.equal(seen.length,10);assert.equal(new Set(seen).size,10);
const canceled=new OriginalUi(catalog),host={isValid:true},callbacks=[];let calls=0;
canceled.loadFrame=()=>{calls++;return new Promise(resolve=>callbacks.push(resolve));};
const task=canceled.prepareComponentFrames('root',host);host.isValid=false;callbacks.forEach(resolve=>resolve({}));await task;assert.equal(calls,6,'route cancellation stops remaining preparation');
console.log('PASS: source adapter bounded six-way preparation, URI deduplication, empty-list exclusion and cancellation; native Cocos still required for layout/timing.');
