"""Bounded ordinary HTTP progression in the named isolated database; not Cocos evidence.
Uses the existing private session and formal authoritative actions. Never writes SQLite,
seeds, levels or assets. Same first-legal policy as the retained basic client autoplay.
"""
import argparse,json,time,uuid,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--battles',type=int,default=1);p.add_argument('--node',type=int,default=201);p.add_argument('--stop-level',type=int,default=10);a=p.parse_args()
if not 1<=a.battles<=32 or not 201<=a.node<=208:raise SystemExit('Only bounded chapter-two repeat progression is supported')
private=json.loads((ROOT/'.local/player-experience/progress-session.json').read_text());base='http://127.0.0.1:7469';out=ROOT/'.local/chapter3-normal/http-progression.jsonl'
headers={'Authorization':'Bearer '+private['token'],'X-Character-Id':private['characterId'],'Content-Type':'application/json'}
def request(path,body=None):
    data=None if body is None else json.dumps(body).encode();r=urllib.request.Request(base+path,data=data,headers=headers)
    with urllib.request.urlopen(r,timeout=45) as response:return json.load(response)
def state():return request('/api/state')
def act(action,payload):
    s=state();body={'action':action,'payload':payload,'requestId':str(uuid.uuid4()),'expectedActorRevision':s['actor']['commandRevision']}
    result=request('/api/act',body)
    return result
for i in range(a.battles):
    s=state()
    if s['actor']['level']>=a.stop_level:break
    if s['battle']:raise SystemExit('Existing active/result battle; finish it in the client first')
    before={k:s['actor'][k] for k in ['level','xp','currencies','deck']};started=time.time();actions=[]
    act('pve.start',{'nodeId':f'main:scene:2:node:{a.node}'})
    for step in range(200):
        s=state();b=s['battle']
        if b['settled']:break
        legal=b['legalPlays'];command={'type':'play',**legal[0]} if legal else {'type':'end'}
        act('battle.command',{'battleId':b['id'],'revision':b['state']['revision'],'action':command});actions.append(command)
    else:raise SystemExit('Bounded action limit reached')
    s=state();b=s['battle'];record={'source':'ordinary formal HTTP actions, no rendering; first-legal basic autoplay policy','id':b['id'],'node':a.node,'before':before,'after':{k:s['actor'][k] for k in ['level','xp','currencies','deck']},'turn':b['state']['turn'],'reward':b['rewards'],'actions':actions,'httpElapsedSeconds':round(time.time()-started,3)}
    with out.open('a') as f:f.write(json.dumps(record,ensure_ascii=False)+'\n')
    act('battle.dismiss',{'battleId':b['id']});print(json.dumps({k:record[k] for k in ['id','turn','reward','after']},ensure_ascii=False),flush=True)
    if not b['rewards']['won']:raise SystemExit('Natural defeat; inspect before retrying')
