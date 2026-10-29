"""Two-phase real HTTP v2 recovery check on isolated port 7470 only."""
import json,uuid,urllib.request,urllib.error,hashlib,sys
from pathlib import Path
R=Path(__file__).resolve().parents[2];L=R/'.local/pve-experience';O=R/'documentation/pve-experience/evidence'
auth=json.loads((R/'.local/player-experience/progress-session.json').read_text());headers={'Authorization':'Bearer '+auth['token'],'X-Character-Id':auth['characterId'],'Content-Type':'application/json'}
def req(p,b=None):
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:7470'+p,headers=headers,data=None if b is None else json.dumps(b).encode()),timeout=30)as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def state():
 code,s=req('/api/state');assert code==200;return s
def act(action,payload):
 s=state();body={'action':action,'payload':payload,'requestId':str(uuid.uuid4()),'expectedActorRevision':s['actor']['commandRevision']};code,result=req('/api/act',body);assert code==200,(code,result);return body,result
def fingerprint(b):return hashlib.sha256(json.dumps(b,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
phase=sys.argv[1]
if phase=='start':
 s=state();assert not s['battle'];act('pve.start',{'nodeId':'main:scene:2:node:203'})
 for _ in range(5):
  b=state()['battle'];assert not b['settled'];p=b['legalPlays'];cmd={'type':'play',**p[0]}if p else{'type':'end'};body,response=act('battle.command',{'battleId':b['id'],'revision':b['state']['revision'],'action':cmd})
 s=state();assert s['battle']['state']['tacticsVersion']==2;checkpoint={'id':s['battle']['id'],'stateHash':fingerprint(s['battle']),'serverInstance':s['serverInstance'],'command':body,'response':response,'actorRevision':s['actor']['commandRevision']};(L/'recovery-start.json').write_text(json.dumps(checkpoint));print('Persisted active v2 battle; ready for service restart')
elif phase=='finish':
 checkpoint=json.loads((L/'recovery-start.json').read_text());s=state();assert fingerprint(s['battle'])==checkpoint['stateHash'];assert s['serverInstance']!=checkpoint['serverInstance'];code,result=req('/api/act',checkpoint['command']);assert code==200 and result['replayed'];assert fingerprint(state()['battle'])==checkpoint['stateHash']
 stale={**checkpoint['command'],'requestId':str(uuid.uuid4()),'expectedActorRevision':s['actor']['commandRevision']};code,_=req('/api/act',stale);assert code==409
 for _ in range(220):
  b=state()['battle']
  if b['settled']:break
  p=b['legalPlays'];act('battle.command',{'battleId':b['id'],'revision':b['state']['revision'],'action':{'type':'play',**p[0]}if p else{'type':'end'}})
 else:raise AssertionError('bounded commands exceeded')
 b=state()['battle'];snapshot=state()['actor'];act('battle.dismiss',{'battleId':b['id']});assert state()['actor']['currencies']==snapshot['currencies']
 out={'scope':'Real formal HTTP isolated ordinary character; recovery/dedup check, not Cocos play or win-rate estimate','battleId':b['id'],'samePublicSnapshotAfterActualRestart':True,'historicalCommandReplayedOnce':True,'staleNewCommandRejected':409,'tacticsVersion':b['state']['tacticsVersion'],'turn':b['state']['turn'],'reward':b['rewards'],'eventCount':len(b['state']['events']),'dismissDidNotRegrant':True};(O/'v2-recovery.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False))
else:raise SystemExit('start or finish')
