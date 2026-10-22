export interface PendingAction {actorId:string;requestId:string;action:string;payload:Record<string,unknown>;expectedActorRevision?:number;createdAt:number}
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v)??'undefined';
/** Persist before transmission. An uncertain operation keeps its immutable ID/content across reloads. */
export class ActionOutbox {
 private records=new Map<string,PendingAction>();
 private storage?:Pick<Storage,'getItem'|'setItem'>;private key:string;private uuid:()=>string;
 constructor(storage?:Pick<Storage,'getItem'|'setItem'>,key='tianxu:outbox',uuid=()=>crypto.randomUUID()){
  this.storage=storage;this.key=key;this.uuid=uuid;
  try{const rows=JSON.parse(storage?.getItem(key)??'[]');if(Array.isArray(rows))for(const r of rows)if(r&&typeof r.actorId==='string'&&typeof r.requestId==='string'&&typeof r.action==='string'&&r.payload&&typeof r.payload==='object')this.records.set(r.actorId,r);}catch{/* A malformed local cache cannot issue any request. */}
 }
 pending(actorId:string){return this.records.get(actorId);}
 prepare(actorId:string,action:string,payload:Record<string,unknown>,expectedActorRevision?:number,requestId?:string){
  payload=JSON.parse(JSON.stringify(payload));const old=this.records.get(actorId);if(old){if(old.action!==action||canonical(old.payload)!==canonical(payload)||(requestId&&old.requestId!==requestId))throw new Error('上一笔操作结果尚未确认，请先重连确认。');return old;}
  const next:PendingAction={actorId,requestId:requestId??this.uuid(),action,payload:JSON.parse(JSON.stringify(payload)),...(expectedActorRevision===undefined?{}:{expectedActorRevision}),createdAt:Date.now()};this.records.set(actorId,next);try{this.persist();}catch(e){this.records.delete(actorId);throw new Error('无法保留请求编号，请检查本地存储后重试。');}return next;
 }
 complete(p:PendingAction){if(this.records.get(p.actorId)?.requestId===p.requestId){this.records.delete(p.actorId);this.persist();}}
 private persist(){this.storage?.setItem(this.key,JSON.stringify(Array.from(this.records.values())));}
}
