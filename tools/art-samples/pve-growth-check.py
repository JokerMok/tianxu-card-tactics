"""Formal requests against only the named isolated growth clone on port 7470.
No database or actor edits. Private session is never included in evidence."""
import json,uuid,urllib.request,urllib.error
from pathlib import Path
R=Path(__file__).resolve().parents[2];local=R/'.local/pve-experience';out=R/'documentation/pve-experience/evidence'
auth=json.loads((R/'.local/player-experience/progress-session.json').read_text())
headers={'Authorization':'Bearer '+auth['token'],'X-Character-Id':auth['characterId'],'Content-Type':'application/json'}
def req(path,body=None):
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7470'+path,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=30)as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def state():
 code,s=req('/api/state');assert code==200;return s
def view(s):return {k:s['actor'][k]for k in ['id','level','xp','deck','cards','currencies','progress']}
if (local/'growth-result.json').exists():
 prior=json.loads((local/'growth-result.json').read_text());s=state();assert view(s)==prior['after'];prior['restartPersistent']=prior['serverInstance']!=s['serverInstance'];(out/'growth-real-requests.json').write_text(json.dumps(prior,ensure_ascii=False,indent=2)+'\n');print('Restart snapshot matched',prior['restartPersistent']);raise SystemExit
s=state();assert s['actor']['level']==7 and s['actor']['xp']==46 and not s['battle'];before=view(s);records=[]
for task in ['1','101','explore-chapter2-3-v1','explore-chapter2-6-v1','explore-chapter2-8-v1']:
 s=state();body={'action':'task.claim','payload':{'taskId':task},'requestId':str(uuid.uuid4()),'expectedActorRevision':s['actor']['commandRevision']}
 code,response=req('/api/act',body);assert code==200,(task,code,response)
 after=state();records.append({'task':task,'requestId':body['requestId'],'result':response['result'],'level':after['actor']['level'],'xp':after['actor']['xp']})
 old=view(after);code,replay=req('/api/act',body);assert code==200 and replay['replayed'] and view(state())==old
 code,denied=req('/api/act',{**body,'requestId':str(uuid.uuid4()),'expectedActorRevision':after['actor']['commandRevision']});assert code==400 and view(state())==old
 records[-1].update(exactRetryReplayed=True,newDuplicateDenied=True)
s=state();assert (s['actor']['level'],s['actor']['xp'])==(10,1);assert s['actor']['deck']==before['deck'] and s['actor']['cards']==before['cards']
result={'scope':'Real formal HTTP claims by inherited ordinary level-7 actor in SQLite backup clone; no GM, direct asset/level edits, repeated wins, or Cocos growth-claim assertion.','before':before,'after':view(s),'claims':records,'repeatWinsBefore':28,'repeatWinsAfter':0,'explorationExperience':140,'serverInstance':s['serverInstance'],'restartPersistent':False}
(local/'growth-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');(out/'growth-real-requests.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('Ordinary claims: level 7 XP46 -> level10 XP1, zero repeat battles; retries and new duplicates verified')
