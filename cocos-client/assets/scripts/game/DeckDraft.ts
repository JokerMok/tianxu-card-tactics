/** Character-scoped draft sessions; polls and acknowledgements cannot replace newer edits. */
export interface DeckSubmission { requestId: string; cards: string[]; actorId: string; expectedDeck:string[] }
interface Session {cards:string[];saved:string[];pending?:DeckSubmission;saving:boolean;error:string;confirmed:boolean}
const fresh=(cards:string[]):Session=>({cards:[...cards],saved:[...cards],saving:false,error:'',confirmed:false});
export class DeckDraft {
 actorId='';private sessions=new Map<string,Session>();private current=fresh([]);private requestId:()=>string;
 constructor(requestId=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`){this.requestId=requestId;}
 get cards(){return this.current.cards;}set cards(v:string[]){this.current.cards=v;}
 get saved(){return this.current.saved;}get pending(){return this.current.pending;}get saving(){return this.current.saving;}
 get error(){return this.current.error;}set error(v:string){this.current.error=v;}get confirmed(){return this.current.confirmed;}
 get dirty(){return this.cards.join('|')!==this.saved.join('|');}
 sync(actorId:string,cards:string[]){const changed=actorId!==this.actorId;if(changed){this.actorId=actorId;let session=this.sessions.get(actorId);if(!session){session=fresh(cards);this.sessions.set(actorId,session);}this.current=session;}if(!this.dirty&&!this.pending&&!this.saving){this.current.saved=[...cards];this.current.cards=[...cards];}return changed;}
 begin(){const s=this.current;if(s.saving)return;s.pending??={requestId:this.requestId(),cards:[...s.cards],actorId:this.actorId,expectedDeck:[...s.saved]};s.saving=true;s.error='';return s.pending;}
 acknowledge(request:DeckSubmission,confirmed:string[]){const s=this.sessions.get(request.actorId);if(!s||s.pending!==request)return;s.saved=[...confirmed];s.pending=undefined;s.saving=false;s.error='';s.confirmed=true;}
 fail(request:DeckSubmission,error:string,uncertain:boolean){const s=this.sessions.get(request.actorId);if(!s||s.pending!==request)return;s.saving=false;s.error=error;if(!uncertain)s.pending=undefined;}
 rebase(cards:string[]){this.current.saved=[...cards];this.current.confirmed=false;}
 revert(){const s=this.current;if(s.saving)return;s.cards=[...s.saved];s.pending=undefined;s.error='';}
}
