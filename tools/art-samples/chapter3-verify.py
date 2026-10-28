"""Focused formal-API retry/restart checks, only port 7469 and the isolated chapter3 DB."""
import json,sqlite3,uuid,urllib.request,urllib.error,hashlib,argparse
from pathlib import Path
R=Path(__file__).resolve().parents[2];L=R/'.local/chapter3-normal';O=R/'documentation/chapter3-normal/evidence'
p=argparse.ArgumentParser();p.add_argument('--after-restart',action='store_true');args=p.parse_args()
c=json.loads((R/'.local/player-experience/progress-session.json').read_text());headers={'Authorization':'Bearer '+c['token'],'X-Character-Id':c['characterId'],'Content-Type':'application/json'}
def request(path,body=None):
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7469'+path,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=30)as res:return res.status,json.load(res)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def state():
 code,s=request('/api/state');assert code==200;return s

def snapshot(s):
 return {'actor':{k:s['actor'][k]for k in ['id','level','xp','deck','cards','inventory','currencies','progress']},'sourceTaskClaims':s['pve']['state']['tasks']['claimed']}
s=state();before=snapshot(s)
if args.after_restart:
 prior=json.loads((L/'persistence-before.json').read_text());assert prior['snapshot']==before
 (O/'persistence.json').write_text(json.dumps({'sameAssetsDeckProgressAndClaims':True,'serverInstanceChanged':prior['serverInstance']!=s['serverInstance'],'snapshot':before},ensure_ascii=False,indent=2)+'\n');print('Restart persistence matched');raise SystemExit
assert s['battle'] is None and 103 in before['sourceTaskClaims']
db=sqlite3.connect('file:'+str(L/'game.sqlite')+'?mode=ro',uri=True)
request_id,fingerprint,result=db.execute("select r.request_id,r.fingerprint,r.result from requests r join operation_audit a on r.request_id=a.request_id and r.principal=a.principal where a.action='task.claim' order by r.created desc limit 1").fetchone();result=json.loads(result)
payload={'taskId':'103'};revision=result['result']['commandRevision']-1
# Confirm the exact original body locally before replaying it.
source={'action':'task.claim','payload':{'payload':payload,'expectedActorRevision':revision}}
assert hashlib.sha256(json.dumps(source,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==fingerprint
body={'requestId':request_id,'action':'task.claim','payload':payload,'expectedActorRevision':revision}
code,replayed=request('/api/act',body);assert code==200 and replayed['replayed']
code2,rejected=request('/api/act',{**body,'requestId':str(uuid.uuid4()),'expectedActorRevision':s['actor']['commandRevision']});assert code2==400
code3,reused=request('/api/act',{**body,'payload':{'taskId':'101'}});assert code3==409
code4,claimed=request('/api/act',{'requestId':str(uuid.uuid4()),'action':'pve.start','payload':{'nodeId':'main:scene:3:node:301','triggerId':'main:scene:3:node:301:trigger:301002'},'expectedActorRevision':s['actor']['commandRevision']});assert code4==400
assert snapshot(state())==before
w=json.loads(db.execute('select json from game_world where id=1').fetchone()[0]);records=[]
for b in w['battles'].values():
 if c['characterId']in b['participants'] and b.get('level',{}).get('sceneId')=='main:scene:3':
  count=db.execute('select count(*) from settlements where battle_id=? and actor_id=?',(b['id'],c['characterId'])).fetchone()[0];assert b['settled']and count==1
  records.append({'battleId':b['id'],'trigger':b['level']['triggerId'],'settlements':count,'won':b['rewards'][c['characterId']]['won']})
db.close()
proof={'originalTaskRequestReplayed':{'status':code,'replayed':True},'newDuplicateTaskRejected':{'status':code2,'error':rejected.get('error')},'sameIdDifferentContentRejected':{'status':code3,'code':reused.get('code')},'alreadyClaimedSourceTriggerRejected':{'status':code4,'error':claimed.get('error')},'assetsUnchanged':True,'settlements':records}
O.joinpath('retry-and-settlement.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
L.joinpath('persistence-before.json').write_text(json.dumps({'serverInstance':s['serverInstance'],'snapshot':before},ensure_ascii=False))
print(json.dumps({k:v for k,v in proof.items()if k!='settlements'},ensure_ascii=False))
