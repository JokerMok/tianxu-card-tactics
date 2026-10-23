import { STAGE_SCOPE, STAGE_PAUSED, stageActionReason, stageSectionAllowed } from '../../cocos-client/assets/scripts/game/StageScope.ts';

const cache = new WeakMap();
const n = x => Number(x) || 0;
export const stageError = message => Object.assign(new Error(message ?? STAGE_PAUSED), {status:409,code:'STAGE_PAUSED'});
export function scopeDefinitions(tables) {
  let data=cache.get(tables);if(data)return data;
  const table=name=>tables[`embeddata/scp/${name}.xml`]??[];
  const index=rows=>new Map(rows.map(r=>[n(r['物品ID\n']??r['物品ID']??r.ID),r]).filter(([id])=>id>0));
  data={medicine:index(table('medicament')),equipment:index(table('equipment')),cards:new Map(table('card').map(r=>[n(r.ID),r])),
    tickets:new Set(table('scene/fubens').filter(r=>n(r['简单'])>0||n(r['普通'])>0).map(r=>n(r['进入消耗道具ID'])).filter(Boolean))};
  cache.set(tables,data);return data;
}
export function stageCardAllowed(tables,id) {
  const row=scopeDefinitions(tables).cards.get(n(String(id).split(':').at(-1)));
  return Boolean(row)&&!STAGE_SCOPE.suspendedSkillIds.includes(n(row.SkillID));
}
function field(row,prefix){return n(Object.entries(row??{}).find(([k])=>k.startsWith(prefix))?.[1]);}
export function itemUseReason(tables,id) {
  const value=n(String(id).split(':').at(-1)),row=scopeDefinitions(tables).medicine.get(value);
  if(!row)return '此物品不能直接使用。';
  const reaction=field(row,'作用id'),p1=field(row,'作用参数1');
  if([1,6,7,8,9,10,11,12,14,999].includes(reaction)||reaction===2&&[7,9].includes(p1))return STAGE_PAUSED;
  // Keep numeric currencies/XP/energy/reputation, fixed packs and ordinary card/item packs.
  return [2,3,4,5].includes(reaction)?null:'本阶段没有启用此物品的使用规则，物品已保留。';
}
export function stageItemAllowed(tables,id) {
  const value=n(String(id).split(':').at(-1)),defs=scopeDefinitions(tables);
  if(defs.tickets.has(value))return true;
  const equipment=defs.equipment.get(value);
  if(equipment)return !/废弃|Abandoned/i.test(String(equipment['名字']??''))&&n(equipment['物品小类'])!==12;
  // Warrant stones/recipes belong to suspended crafting. Do not create more dead counters.
  return defs.medicine.has(value)&&!itemUseReason(tables,value);
}
export function stageRewardAllowed(tables,kind,id) {
  return kind==='card'?stageCardAllowed(tables,id):kind==='item'?stageItemAllowed(tables,id):['silver','gold','crystal','xp','reputation'].includes(kind);
}
export function legacyClaimKey(action,p={}) {
  return JSON.stringify([action,...['taskId','questId','groupId','track','level','index','key','seasonKey','rewardId','collectionId','season'].map(k=>p[k]??null)]);
}
const pausedClaims=new Set(['activity.chest','activity.weeklyGrant','activity.rewardBonus','quest.returnClaim','collection.claim']);
export function stageClaimPaused(action,p={}) {return pausedClaims.has(action)||action==='quest.repeatClaim'&&p.questId!=='growth-actions'||action==='battlePass.claim'&&p.track&&p.track!=='free';}
export function initializeStage(ctx,sections) {
  const {actor,world,now}=ctx;if(actor.stageScope?.id===STAGE_SCOPE.id)return false;
  const claims=sections.flatMap(s=>s.items??[]).filter(i=>!i.disabled&&(stageClaimPaused(i.action,i.payload)||i.action==='task.claim'));
  actor.stageScope={id:STAGE_SCOPE.id,startedAt:now,claims:Object.fromEntries(claims.map(i=>[legacyClaimKey(i.action,i.payload),i])),
    dailyCounters:{...actor.growth?.dailyCounters},pass:structuredClone(actor.growth?.battlePass??{}),passEarnedLevel:Math.max(1,Math.min(50,Math.max(Math.floor((actor.growth?.battlePass?.exp??0)/500),Math.floor((actor.growth?.counters?.growthActions??0)/5))+1)),
    inventory:{...actor.inventory},battles:Object.values(world.battles??{}).filter(b=>b.participants.includes(actor.id)&&!b.dismissed?.includes(actor.id)).map(b=>b.id),
    rooms:Object.values(world.rooms??{}).filter(r=>r.members.includes(actor.id)&&r.status==='waiting').map(r=>r.id),
    unresolved:[]};
  if(actor.competition?.tournament?.status==='active')actor.stageScope.unresolved.push('旧竞技赛报名未结束：暂无可靠退款规则，保留报名与费用记录，待确定退场方式。');
  return true;
}
export function stageActionGuard(ctx,action,p={}) {
  const why=stageActionReason(action,p);if(why)throw stageError(why);
  if(['room.start','room.ready'].includes(action)&&!ctx.actor.stageScope?.rooms?.includes(p.roomId))throw stageError();
  if(action==='shop.skill.buy'&&!stageCardAllowed(ctx.tables,p.cardId))throw stageError('该技能本阶段暂停新增获得。');
  if(action==='inventory.use') {const why=itemUseReason(ctx.tables,p.itemId);if(why)throw stageError(why);}
  const archivedPass=action==='battlePass.claim'&&p.season?ctx.actor.growth?.battlePassArchive?.[p.season]:null;
  const archivedRight=Boolean(archivedPass&&n(p.level)<=n(archivedPass.earnedLevel)&&((p.track??'free')==='free'||archivedPass[p.track]&&n(p.level)<=n(archivedPass.premiumMax)));
  if(stageClaimPaused(action,p)&&!archivedRight&&!ctx.actor.stageScope?.claims?.[legacyClaimKey(action,p)])throw stageError('本阶段已停止新增该奖励；已形成的旧权益仍可领取。');
  if(archivedRight||ctx.actor.stageScope?.claims?.[legacyClaimKey(action,p)]){ctx.legacyRewards=true;ctx.legacyClock=ctx.actor.stageScope.startedAt;ctx.legacyDaily=ctx.actor.stageScope.dailyCounters;}
  if(action==='inventory.use') {
    const key=String(p.itemId).includes(':')?p.itemId:`main:item:${p.itemId}`;
    if(n(ctx.actor.stageScope?.inventory?.[key])>=n(p.count??1))ctx.legacyRewards=true;
  }
}
export function stageFilterSections(ctx,sections) {
  const legacy=[];
  const titles={progression:'战令与日常',city:'税收',shop:'商店',equipment:'角色与装备',tasks:'主线任务'};
  const result=sections.map(section=>({...section,title:titles[section.id]??section.title,items:(section.items??[]).filter(item=>{
    try{stageActionGuard({...ctx},item.action,item.payload??{});}catch{return false;}
    if(stageClaimPaused(item.action,item.payload)) {legacy.push(item);return false;}
    return true;
  })})).filter(s=>stageSectionAllowed(s.id)&&(s.items.length||['inventory','equipment'].includes(s.id)));
  // Existing rights remain reachable even when their original page is suspended.
  for(const s of sections.filter(s=>!stageSectionAllowed(s.id)))for(const item of s.items??[]) {
    if(item.disabled||stageActionReason(item.action,item.payload))continue;
    if(!/claim|cancel|leave|transfer|accept|delete|remove|respond/.test(item.action))continue;
    try{stageActionGuard({...ctx},item.action,item.payload??{});legacy.push(item);}catch{}
  }
  for(const item of Object.values(ctx.actor.stageScope?.claims??{}))if(![...legacy,...result.flatMap(s=>s.items)].some(i=>legacyClaimKey(i.action,i.payload)===legacyClaimKey(item.action,item.payload)))legacy.push(item);
  for(const message of ctx.actor.stageScope?.unresolved??[])legacy.push({label:'旧状态待处理',detail:message,action:'stage.notice',payload:{},disabled:true});
  const social=ctx.social;
  for(const row of social?.trades??[])if(row.status==='open'&&[row.from,row.to].includes(ctx.actor.id))legacy.push({label:'处理旧交易',action:row.from===ctx.actor.id?'trade.cancel':'trade.accept',payload:{tradeId:row.id}});
  for(const row of social?.auctions??[])if(row.status==='open'&&row.seller===ctx.actor.id&&!row.bidder)legacy.push({label:'撤回旧拍卖',action:'auction.cancel',payload:{auctionId:row.id}});
  for(const room of Object.values(ctx.world.rooms??{}).filter(r=>r.status==='waiting'&&r.members.includes(ctx.actor.id)))legacy.push({label:'退出旧房间',action:'room.leave',payload:{roomId:room.id}});
  if(ctx.actor.guildId){
    const guild=ctx.world.guilds?.[ctx.actor.guildId];
    if(guild?.leader===ctx.actor.id&&guild.members.length>1)legacy.push({label:'移交原公会会长',action:'guild.transfer',payload:{},fields:[{key:'target',label:'接任成员',type:'select',options:guild.members.filter(id=>id!==ctx.actor.id).map(id=>({value:id,label:ctx.world.characters?.[id]?.name??id}))}]});
    legacy.push({label:'退出原公会',action:'guild.leave',payload:{}});
  }
  if(legacy.length)result.push({id:'legacy',title:'原有权益',items:legacy});
  return result;
}
export function stageTaskAllowed(task,tables) {
  const allowed=new Set([1,2,3,4,8,10,13,24,29,30,31,32,40]);
  return task.targets?.length>0&&task.targets.every(t=>allowed.has(t.type)
    &&(t.type!==24||stageItemAllowed(tables,t.params.goodid1)&&(!t.params.goodid2||stageItemAllowed(tables,t.params.goodid2)))
    &&(![8,31,32].includes(t.type)||!n(t.params.sameguild)&&[0,1].includes(n(t.params.mode)))
    &&(t.type!==29||n(t.params.rank)<=6))
    &&task.conditions.every(c=>[1,2,3,4].includes(c.type));
}
export function stageSceneAllowed(tables,id) {
  const value=n(String(id).split(':').at(-1));
  if(value>=1&&value<=19)return true;
  if([2501,2502,2503,6301].includes(value))return false;
  return stageDungeonAllowed(tables,value);
}
export function stageDungeonAllowed(tables,id) {
  const rows=tables['embeddata/scp/scene/fubens.xml']??[];
  return ![2501,2502,2503,6301].includes(n(id))&&rows.some(r=>[r['简单'],r['普通']].map(n).includes(n(id)));
}
export function stageDeckIssues(actor,tables) {
  const issues=[];for(const id of new Set(actor.deck??[])){
    const need=actor.deck.filter(x=>x===id).length,have=n(actor.cards[id]);
    if(have<need)issues.push(`${id}：卡组需${need}张，持有${have}张，请移除缺少的卡牌后保存。`);
    if(!stageCardAllowed(tables,id))issues.push(`${id}：关联集结点技能本阶段暂缓，请换牌后保存；持有卡已保留。`);
  }return issues;
}
export {STAGE_SCOPE};
