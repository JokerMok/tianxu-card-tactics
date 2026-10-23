import {stageRewardAllowed} from './stage-policy.mjs';
import {randomUUID} from 'node:crypto';
import {digest,stable,requireText,requireCount,conflict} from './store.mjs';
import {grantManagedResource} from './growth-systems.mjs';
import {presentationNames} from './presentation.mjs';
import {activeCard} from '../../cocos-client/assets/scripts/game/GameText.ts';

const PERMISSIONS = ['players','resources','logs','currency','card','item'];
export const MAX_LIMITS = Object.freeze({silver:1000000,gold:10000,crystal:10000,card:100,item:1000});
export const DEFAULT_LIMITS = Object.freeze({silver:10000,gold:100,crystal:100,card:10,item:100});
export const DEFAULT_PERMISSIONS = Object.freeze(Object.fromEntries(PERMISSIONS.map(k=>[k,true])));
const OFF = Object.fromEntries(PERMISSIONS.map(k=>[k,false]));
// Deliberately only items whose count/binding/consumption paths are implemented.
// Equipment, expiring/instance items and unsupported source-version content are
// rejected rather than inserted as misleading inventory counters.
const ITEMS = [
  [2,'medicament','转职水晶','Class Selection Crystal'],
  [8,'medicament','改名卡','Change Name Card'],
  [9,'medicament','性别转换卡','Change Gender Card'],
  [100,'warrant','普通强化石','Good Gem'],
  [101,'warrant','稀有强化石','Rare Gem'],
  [102,'warrant','史诗强化石','Epic Gem'],
  [103,'warrant','传说强化石','Legendary Gem'],
  [1101,'medicament','初级宠物精华包','Basic Pet Essence Pack'],
];
const error = (message,code='GM_INVALID',status=400) => Object.assign(new Error(message),{code,status});
export function exactKeys(value, allowed, required=allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k=>!allowed.includes(k)) || required.some(k=>!Object.hasOwn(value,k))) throw error('请求字段无效');
}
function pageInfo(query) {
  const page=Number(query.page??1),pageSize=Number(query.pageSize??20);
  if (!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>50) throw error('分页参数无效');
  return {page,pageSize,offset:(page-1)*pageSize};
}
function operationId(payload) {
  const id = requireText(payload.operationId,'操作ID',100);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw error('操作ID格式无效');
  return id;
}
function normalizeAccess(role, permissions, limits) {
  if (!['player','gm','super_admin'].includes(role)) throw error('角色权限无效');
  if (role==='player') return {role,permissions:{...OFF},limits:Object.fromEntries(Object.keys(MAX_LIMITS).map(k=>[k,0]))};
  if (role==='super_admin') return {role,permissions:{...DEFAULT_PERMISSIONS},limits:{...MAX_LIMITS}};
  exactKeys(permissions,PERMISSIONS);exactKeys(limits,Object.keys(MAX_LIMITS));
  for (const k of PERMISSIONS) if(typeof permissions[k]!=='boolean')throw error('授权开关必须是布尔值');
  for (const [k,max] of Object.entries(MAX_LIMITS)) if(!Number.isSafeInteger(limits[k])||limits[k]<0||limits[k]>max)throw error('单次发放上限无效：'+k);
  return {role,permissions:{...permissions},limits:{...limits}};
}

export class GmService {
  constructor(store,content) { this.store=store;this.content=content;this.catalog=null; }
  account(id) {
    const row=this.store.db.prepare('SELECT id,username,created FROM accounts WHERE id=?').get(requireText(id,'账号ID',100));
    if(!row)throw error('账号不存在','GM_ACCOUNT_NOT_FOUND',404);
    return row;
  }
  access(accountId) {
    const row=this.store.db.prepare('SELECT * FROM gm_access WHERE account_id=?').get(accountId);
    if(!row)return {...normalizeAccess('player'),revision:0};
    return {role:row.role,permissions:JSON.parse(row.permissions),limits:JSON.parse(row.limits),revision:row.revision};
  }
  authorize(accountId,permission) {
    const access=this.access(accountId);
    if(!['gm','super_admin'].includes(access.role))throw error('当前账号没有管理权限','GM_FORBIDDEN',403);
    if(permission==='manageGm'&&access.role!=='super_admin')throw error('仅超级管理员可配置权限','GM_FORBIDDEN',403);
    if(permission&&permission!=='manageGm'&&!access.permissions[permission])throw error('未获得此项管理权限','GM_FORBIDDEN',403);
    return access;
  }
  identity(accountId) {
    const access=this.authorize(accountId),account=this.account(accountId);
    return {account:{id:account.id,username:account.username,role:access.role},permissions:{...access.permissions,manageGm:access.role==='super_admin'},limits:access.limits};
  }
  players(operator,query={}) {
    this.authorize(operator,'players');const paging=pageInfo(query),q=String(query.q??'').trim().toLowerCase();
    if(q.length>100)throw error('搜索内容过长');
    const world=this.store.read(),characters=Object.values(world.characters);
    const accounts=this.store.db.prepare('SELECT id,username FROM accounts ORDER BY created,id').all().map(a=>({id:a.id,username:a.username,role:this.access(a.id).role,
      characters:characters.filter(c=>c.accountId===a.id).map(c=>({id:c.id,name:c.name,level:c.level,currencies:c.currencies}))}));
    const matches=accounts.filter(a=>!q||[a.id,a.username,...a.characters.flatMap(c=>[c.id,c.name])].some(v=>String(v).toLowerCase().includes(q)));
    return {accounts:matches.slice(paging.offset,paging.offset+paging.pageSize),total:matches.length,page:paging.page,pageSize:paging.pageSize};
  }
  character(operator,accountId,characterId) {
    this.authorize(operator,'players');this.account(accountId);const c=this.store.read().characters[characterId];
    if(!c||c.accountId!==accountId)throw error('目标角色不存在或不属于该账号','GM_CHARACTER_NOT_FOUND',404);
    return {accountId,characterId:c.id,name:c.name,level:c.level,currencies:c.currencies,cards:c.cards,inventory:c.inventory};
  }
  resourceCatalog() {
    if(this.catalog)return this.catalog;
    const names=presentationNames(this.content),items=[];
    for(const [resourceId,name]of Object.entries({silver:'银币',gold:'金币',crystal:'晶石'}))items.push({type:'currency',resourceId,name});
    for(const c of Object.values(this.content.catalog.scopes.main.cards))if(activeCard(this.content.catalog,c)&&stageRewardAllowed(this.content.tables,'card',c.id))items.push({type:'card',resourceId:c.id,name:names[c.id]??String(c.raw.Name),source:this.content.catalog.localization?.cards[c.id]?.status??'source'});
    for(const [id,table,name,originalName]of ITEMS){
      if(!stageRewardAllowed(this.content.tables,'item',id))continue;
      const row=this.content.table(table).find(r=>(r['物品ID']??r['物品ID\n']??r.ID)===id);
      if(!row||row['名字']!==originalName||/废弃|Abandoned/i.test(row['名字']))continue;
      const stack=Number(Object.entries(row).find(([k])=>k.startsWith('叠放数量'))?.[1]);
      if(!Number.isSafeInteger(stack)||stack<1)continue;
      items.push({type:'item',resourceId:'main:item:'+id,name,maxStack:stack,source:'candidate-translation',originalName,table});
    }
    return this.catalog=items;
  }
  resources(operator,query={}) {
    this.authorize(operator,'resources');const paging=pageInfo(query),q=String(query.q??'').toLowerCase();
    if(q.length>100||!['currency','card','item'].includes(query.type))throw error('资源筛选无效');
    const items=this.resourceCatalog().filter(r=>r.type===query.type&&(!q||[r.name,r.resourceId,r.originalName].some(x=>String(x??'').toLowerCase().includes(q))));
    return {items:items.slice(paging.offset,paging.offset+paging.pageSize),total:items.length,page:paging.page,pageSize:paging.pageSize};
  }
  audit(operator,action,payload,response,result='success',errorCode=null) {
    this.store.db.prepare('INSERT INTO gm_audit VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),
      typeof payload.operationId==='string'?payload.operationId.slice(0,100):null,operator,
      typeof payload.targetAccountId==='string'?payload.targetAccountId.slice(0,100):null,
      typeof payload.targetCharacterId==='string'?payload.targetCharacterId.slice(0,100):null,action,
      typeof payload.type==='string'?payload.type.slice(0,30):null,typeof payload.resourceId==='string'?payload.resourceId.slice(0,100):null,
      Number.isSafeInteger(payload.quantity)?payload.quantity:null,
      response?.before===undefined?null:JSON.stringify(response.before),response?.after===undefined?null:JSON.stringify(response.after),
      typeof payload.reason==='string'?payload.reason.slice(0,500):'',Date.now(),result,errorCode);
  }
  execute(operator,action,payload,permission,fn,{terminal=false}={}) {
    if(!terminal)this.authorize(operator,permission);
    const id=operationId(payload),fingerprint=digest(stable({action,payload}));
    const old=this.store.db.prepare('SELECT * FROM gm_operations WHERE operation_id=?').get(id);
    if(old){
      if(old.operator_id!==operator||old.fingerprint!==fingerprint)throw conflict('操作ID已用于不同内容','REQUEST_REUSE');
      const result=JSON.parse(old.response);
      if(result.result==='rejected')throw error(result.error,result.code,result.status);
      return {...result,replayed:true};
    }
    try {
      const tx=this.store.transaction('gm:'+operator,id,action,payload,world=>{
        if(!terminal)this.authorize(operator,permission);
        const response={operationId:id,result:'success',...fn(world),serverTime:new Date().toISOString()};
        this.audit(operator,action,payload,response);
        this.store.db.prepare('INSERT INTO gm_operations VALUES(?,?,?,?,?)').run(id,operator,fingerprint,JSON.stringify(response),Date.now());
        return response;
      });
      return {...tx.result,replayed:tx.replayed};
    } catch(e) {
      // Infrastructure failures remain retryable. A rejected business operation
      // gets its own durable receipt/audit after the asset transaction rolled back.
      if(e instanceof TypeError||e instanceof ReferenceError||String(e.code??'').startsWith('ERR_SQLITE'))throw e;
      const response={operationId:id,result:'rejected',error:e.message,code:e.code??'GM_INVALID',status:e.status??400};
      this.store.scheduled(()=>{
        this.audit(operator,action,payload,null,'rejected',response.code);
        this.store.db.prepare('INSERT OR IGNORE INTO gm_operations VALUES(?,?,?,?,?)').run(id,operator,fingerprint,JSON.stringify(response),Date.now());return false;
      });
      throw Object.assign(e,{code:response.code,status:response.status});
    }
  }
  grant(operator,payload) {
    return this.execute(operator,'gm.grant',payload,null,world=>{
      exactKeys(payload,['operationId','targetAccountId','targetCharacterId','type','resourceId','quantity','reason']);
      const reason=requireText(payload.reason,'发放原因',500),access=this.authorize(operator,payload.type);
      if(!['currency','card','item'].includes(payload.type))throw error('资源类型无效');
      this.account(payload.targetAccountId);const actor=world.characters[payload.targetCharacterId];
      if(!actor||actor.accountId!==payload.targetAccountId)throw error('目标角色不存在或不属于所选账号','GM_CHARACTER_NOT_FOUND',404);
      const resource=this.resourceCatalog().find(r=>r.type===payload.type&&r.resourceId===payload.resourceId);
      if(!resource)throw error('资源未启用或尚无可靠发放规则','GM_RESOURCE_UNSUPPORTED');
      const key=payload.type==='currency'?payload.resourceId:payload.type;
      const quantity=requireCount(payload.quantity,'增加数量',access.limits[key]);
      const map=payload.type==='currency'?actor.currencies:payload.type==='card'?actor.cards:actor.inventory;
      const before=map?.[payload.resourceId]??0,after=before+quantity;
      if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after))throw error('资源数量超出安全范围','GM_OVERFLOW');
      if(resource.maxStack&&after>resource.maxStack)throw error('超过该道具叠放上限','GM_STACK_LIMIT');
      grantManagedResource({actor,world,tables:this.content.tables,now:Date.now()},payload.type,payload.resourceId,quantity,payload.operationId);
      actor.commandRevision=(actor.commandRevision??0)+1;
      return {targetAccountId:actor.accountId,targetCharacterId:actor.id,type:payload.type,resourceId:resource.resourceId,name:resource.name,quantity,before,after,reason};
    });
  }
  changeAccess(operator,payload,{terminal=false}={}) {
    return this.execute(operator,'gm.access',payload,'manageGm',()=>{
      exactKeys(payload,['operationId','targetAccountId','role','permissions','limits','reason']);
      this.account(payload.targetAccountId);requireText(payload.reason,'权限变更原因',500);
      const next=normalizeAccess(payload.role,payload.permissions,payload.limits),before=this.access(payload.targetAccountId);
      if(before.role==='super_admin'&&next.role!=='super_admin'&&this.store.db.prepare("SELECT count(*) AS n FROM gm_access WHERE role='super_admin'").get().n<=1)throw error('不能撤销最后一个超级管理员','GM_LAST_SUPER_ADMIN',409);
      const after={...next,revision:before.revision+1};
      this.store.db.prepare('INSERT INTO gm_access VALUES(?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET role=excluded.role,permissions=excluded.permissions,limits=excluded.limits,revision=excluded.revision,updated=excluded.updated').run(payload.targetAccountId,next.role,JSON.stringify(next.permissions),JSON.stringify(next.limits),after.revision,Date.now());
      this.store.db.prepare('DELETE FROM gm_sessions WHERE account_id=?').run(payload.targetAccountId);
      return {targetAccountId:payload.targetAccountId,before,after};
    },{terminal});
  }
  getAccess(operator,target) { this.authorize(operator,'manageGm');return {account:this.account(target),access:this.access(target)}; }
  operation(operator,id) {
    const access=this.authorize(operator);const row=this.store.db.prepare('SELECT * FROM gm_operations WHERE operation_id=?').get(id);
    if(!row)throw error('该操作尚未确认，可用原操作ID重试','GM_OPERATION_NOT_FOUND',404);
    if(row.operator_id!==operator&&!access.permissions.logs)throw error('无权查询其他操作者的回执','GM_FORBIDDEN',403);
    return {operation:JSON.parse(row.response)};
  }
  logs(operator,query={}) {
    this.authorize(operator,'logs');const paging=pageInfo(query),where=[],args=[];
    for(const [param,column]of Object.entries({operatorAccountId:'operator_id',targetAccountId:'target_account_id',targetCharacterId:'target_character_id',type:'type',resourceId:'resource_id',result:'result'}))if(query[param]){where.push(column+'=?');args.push(requireText(query[param],'筛选条件',100));}
    for(const [key,sign]of [['from','>='],['to','<=']])if(query[key]){const date=Date.parse(query[key]);if(!Number.isFinite(date))throw error('时间筛选无效');where.push('created'+sign+'?');args.push(date);}
    const filter=where.length?' WHERE '+where.join(' AND '):'',total=this.store.db.prepare('SELECT count(*) AS n FROM gm_audit'+filter).get(...args).n;
    const rows=this.store.db.prepare('SELECT * FROM gm_audit'+filter+' ORDER BY created DESC,id DESC LIMIT ? OFFSET ?').all(...args,paging.pageSize,paging.offset);
    return {items:rows.map(r=>({operationId:r.operation_id,operatorAccountId:r.operator_id,targetAccountId:r.target_account_id,targetCharacterId:r.target_character_id,action:r.action,type:r.type,resourceId:r.resource_id,quantity:r.quantity,before:r.before_json===null?null:JSON.parse(r.before_json),after:r.after_json===null?null:JSON.parse(r.after_json),reason:r.reason,serverTime:new Date(r.created).toISOString(),result:r.result,errorCode:r.error_code})),total,page:paging.page,pageSize:paging.pageSize};
  }
}
