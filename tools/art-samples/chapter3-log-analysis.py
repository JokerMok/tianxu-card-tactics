"""Read only prior ordinary chapter 1/2 logs; do not replay those chapters."""
import sqlite3,json,collections,statistics
from pathlib import Path
R=Path(__file__).resolve().parents[2];D=R/'documentation/chapter3-normal/evidence';D.mkdir(parents=True,exist_ok=True)
db=sqlite3.connect('file:'+str(R/'.local/chapter2-normal/game.sqlite')+'?mode=ro',uri=True);w=json.loads(db.execute('select json from game_world').fetchone()[0]);a=json.loads((R/'.local/chapter3-normal/initial-state.json').read_text())['actor']['id'];rows=[]
for b in w['battles'].values():
 if a not in b['participants'] or b.get('level',{}).get('sceneId') not in ['main:scene:1','main:scene:2']:continue
 es=b['state']['events'];enemies=[p for p in b['entryState']['players']if p['team']==1];units={}
 for e in es:
  for key in ['actorView','targetView']:
   u=e.get(key)
   if u and not u['flags']['hero']:units[u['id']]=u
 enemyDamage=[e for e in es if e['type']=='damage' and e.get('targetView',{}).get('flags',{}).get('hero') and e['targetView']['team']==1]
 deaths=[e for e in es if e['type']=='death' and e.get('actorView',{}).get('flags',{}).get('hero') and e['actorView']['team']==1]
 damage=lambda kind:sum(e.get('effectiveAmount',e.get('amount',0))for e in enemyDamage if (e.get('message')=='fatigue')==kind)
 phases=[];current=None
 for e in es:
  if e['type']=='turn-start':
   if current:phases.append(current)
   current={'actor':e['actor'],'turn':e['amount'],'actions':collections.Counter()}
  elif current:current['actions'][e['type']]+=1
 if current:phases.append(current)
 def meaningful(p):return any(p['actions'][t] for t in ['play','move','attack','skill','summon','effect','status','heal'])
 enemyIds={p['id']for p in enemies};ep=[p for p in phases if p['actor']in enemyIds]
 still=[{'id':uid,'monsterId':u['monsterId'],'aiType':u['flags'].get('aiType'),'team':u['team']}for uid,u in units.items()if not any(e['type']in ['move','attack']and e.get('actor')==uid for e in es)]
 rows.append({'id':b['id'],'scene':b['level']['sceneId'],'node':b['level']['nodeId'],'trigger':b['level']['triggerId'],'won':b['rewards'].get(a,{}).get('won'),'turnCounter':b['state']['turn'],'turnStarts':sum(e['type']=='turn-start'for e in es),'playerCommands':sum(e['type']=='play'and e.get('actor')==a for e in es)+sum(e['type']=='turn-end'and e.get('actor')==a for e in es),'wallSeconds':round((b.get('settledAt',b['createdAt'])-b['createdAt'])/1000,3),'eventTypes':dict(collections.Counter(e['type']for e in es)),'enemyHeroes':[{'monsterId':p['monsterId'],'hp':p['hp'],'name':p['name'],'deck':p['deck']}for p in enemies],'enemyHeroDamage':{'combat':damage(False),'fatigue':damage(True)},'enemyHeroLastHit':[next((e.get('message','combat')for e in reversed(es[:es.index(d)])if e['type']=='damage'and e.get('target')==d['actor']),None)for d in deaths],'enemyPhases':len(ep),'enemyPhasesWithoutPlayMoveAttackEffect':sum(not meaningful(p)for p in ep),'unitsWithNoMoveOrAttack':still})
for row in rows:
 stamps=[x[0] for x in db.execute("select r.created from requests r join operation_audit a on r.request_id=a.request_id and r.principal=a.principal where a.action='battle.command' and json_extract(r.result,'$.result.battleId')=? order by r.created",(row['id'],))]
 battle=w['battles'][row['id']]
 row['successfulCommandTiming']={'count':len(stamps),'firstToSettlementSeconds':round((battle['settledAt']-stamps[0])/1000,3)if stamps else None,'largestGapSeconds':round(max([b-a for a,b in zip(stamps,stamps[1:])],default=0)/1000,3)}
db.close()
D.joinpath('previous-chapters-experience.json').write_text(json.dumps({'scope':'Existing isolated ordinary character battle logs only. Wall times include manual thinking, pauses and restarts; subsecond HTTP samples do not measure Cocos time. Empty enemy phases can be caused by preparation or conservative movement and are not automatically bugs.','records':rows},ensure_ascii=False,indent=2)+'\n')
for chapter in [1,2]:
 rr=[r for r in rows if r['scene']==f'main:scene:{chapter}'];print(chapter,'battles',len(rr),'fatigue finishes',sum(r['enemyHeroLastHit']==['fatigue']for r in rr),'turns',[r['turnCounter']for r in rr],'combat',sum(r['enemyHeroDamage']['combat']for r in rr),'fatigue',sum(r['enemyHeroDamage']['fatigue']for r in rr))
