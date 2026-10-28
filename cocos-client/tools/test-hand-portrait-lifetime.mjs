// Targeted async lifetime regression, not an engine or visual acceptance test.
// Execute the actual method with only the delayed image boundary stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../assets/scripts/game/BattleSceneView.ts',import.meta.url),'utf8');
const start=source.indexOf('  private async drawSmallCard('),end=source.indexOf('  private renderHud(',start);
assert.ok(start>=0&&end>start);
const method=source.slice(start,end).replace('private async','async');
const Subject=new Function('UIOpacity',stripTypeScriptTypes('class Subject {\n'+method+'\n}\n;Subject',{mode:'strip'})+';return Subject;')(class {});
for (const cancellation of ['released-parent','disposed-view']) test(`delayed hand portrait cannot mutate a ${cancellation}`,async()=>{
  let resolve,attached=0;const image=new Promise(r=>{resolve=r});
  const view=new Subject(),parent={isValid:true},portrait={isValid:true,addComponent(){attached++;throw new Error('Component attached after release')}};
  Object.assign(view,{disposed:false,catalog:{assets:{art:{path:'portrait.png'}}},base:'',ui:{image:()=>image}});
  const work=view.drawSmallCard(parent,{art:['art']},2,false);
  if(cancellation==='released-parent'){parent.isValid=false;portrait.isValid=false;}else view.disposed=true;
  resolve(portrait);await assert.doesNotReject(work);assert.equal(attached,0);
});
