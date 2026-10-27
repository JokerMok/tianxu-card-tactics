"""Build separate display mappings from enabled main card data; never mutate raw source rows."""
from pathlib import Path
import json,re,collections
ROOT=Path(__file__).resolve().parents[1];LOC=ROOT/'cocos-client/assets/resources/localization';LOC.mkdir(parents=True,exist_ok=True)
cat=json.loads((ROOT/'cocos-client/assets/resources/recovered/catalog.json').read_text());d=cat['scopes']['main'];preview=json.loads((LOC/'preview-zh-seed.json').read_text())
def read(name,key):
 p=LOC/name
 return json.loads(p.read_text()).get(key,{})if p.exists() else {}
names=read('card-names.json','names');effects=read('effects-zh.json','effects');effects.update({k:v for k,v in read('effect-composites-zh.json','effects').items()if v.get('status')!='missing'});effects.update({k:v for k,v in read('effect-composites-tail-zh.json','effects').items()if v.get('status')!='missing'});skills=read('skill-cards-zh.json','skills');pnames={c['originalName']:c for c in preview['cards']}
for e in preview['effects'] if isinstance(preview['effects'],list) else preview['effects'].values():
 effects.setdefault(e['id'],dict(e,source='reviewed preview; English source translation'))
active=[c for c in d['cards'].values()if not re.search(r'废弃|\(Abandoned\)',str(c['raw'].get('Name','')),re.I)and((c['raw'].get('Type')==1 and str(c['raw'].get('MonsterID'))in d['monsters'])or(c['raw'].get('Type')==2 and str(c['raw'].get('SkillID'))in d['skills']))]
result={'version':1,'sourceManifest':cat['sourceManifest'],'note':'Chinese display candidates remain distinct from recovered official text. Original IDs/raw fields/rules unchanged.','cards':{},'effects':{},'skills':{},'stories':read('campaign-stories-zh.json','stories')};missing={'cardNames':[],'effects':[],'skillDescriptions':[]}
for c in active:
 r=c['raw'];name=str(r.get('Name',''));p=pnames.get(name);n=names.get(name)
 if n: shown={'name':n['name'],'status':n['status'],'source':n['source']}
 elif p:shown={'name':p['name'],'status':p['nameStatus'],'source':p['nameEvidence']}
 elif re.search('[\u4e00-\u9fff]',name):shown={'name':name,'status':'recovered','source':'source Card.Name'}
 else:shown={'name':name,'status':'missing','source':'source Card.Name; untranslated'};missing['cardNames'].append(c['id'])
 result['cards'][c['id']]=dict(shown,originalName=name,sourceRow=r.get('_row'))
 if r['Type']==1:
  m=d['monsters'][str(r['MonsterID'])]
  for i in range(1,6):
   e=d['effects'].get(str(m.get('ability'+str(i))))
   if not e:continue
   key='main:effect:'+str(e['EffectID']);t=effects.get(key)
   if t:result['effects'][key]=dict(t,originalName=e.get('Name',''),originalText=str(e.get('EffectDes','')),sourceRow=e.get('_row'))
   else:result['effects'][key]={'name':str(e.get('Name','')),'text':str(e.get('EffectDes','')),'status':'missing','source':'source effect; untranslated','originalName':e.get('Name',''),'originalText':str(e.get('EffectDes','')),'sourceRow':e.get('_row')}
 else:
  t=skills.get(c['id']);desc=r.get('Des','')
  linked=d['skills'].get(str(r.get('SkillID')),{}).get('raw')or{}
  linked_text=linked.get('Des')
  if c['id'] in ['main:card:50808','main:card:50809','main:card:50903'] and linked_text and (not t or t.get('status')=='missing'):
   translated='进入该格子的生物受到3点火焰伤害；在该格子结束回合的生物受到'+('5'if c['id']=='main:card:50809'else'3')+'点火焰伤害。' if c['id']!='main:card:50903'else'任意玩家的生物进入结界之地时，移除其全部增益效果；停留其中时无法获得增益效果。'
   t={'name':shown['name'],'text':translated,'status':'candidate','source':'linked Skill.Des; Card.Des is non-text zero','originalText':linked_text}
  if t:result['skills'][c['id']]=dict(t,name=shown['name'])
  elif isinstance(desc,str)and re.search('[\u4e00-\u9fff]',desc):result['skills'][c['id']]={'name':shown['name'],'text':desc,'status':'recovered','source':'source Card.Des'}
  else:result['skills'][c['id']]={'name':shown['name'],'text':str(desc),'status':'missing','source':'source Card.Des; untranslated'}
for k,e in result['effects'].items():
 if e['status']=='candidate':
  if re.search(r'\bOgres?\b',e.get('originalText',''),re.I):e['text']=e['text'].replace('巨魔','食人魔')
  if re.search(r'\bGoblins?\b',e.get('originalText',''),re.I):e['text']=e['text'].replace('地精','哥布林')
 if e['status']=='missing':missing['effects'].append(k)
for k,s in result['skills'].items():
 if s['status']=='missing':missing['skillDescriptions'].append(k)
coverage={'scope':'Current main player-visible Type1 linked monster and Type2 linked skill. Runtime support is tracked separately in unsupportedSkillCards. Includes card-pool, atlas, reward and upgrades; excludes deprecated/Abandoned and other-version media scope.','sourceManifest':cat['sourceManifest'],'activeCards':len(active),'distinctNames':len(set(c['raw']['Name']for c in active)),'cardNames':dict(collections.Counter(v['status']for v in result['cards'].values())),'effects':dict(collections.Counter(v['status']for v in result['effects'].values())),'skillDescriptions':dict(collections.Counter(v['status']for v in result['skills'].values())),'missing':missing,'unsupportedSkillCards':[k for k,v in result['skills'].items()if v['status']=='unsupported']}
(LOC/'game-zh.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));out=ROOT/'documentation/ui-integration';out.mkdir(parents=True,exist_ok=True);(out/'chinese-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in coverage.items()if k!='missing'},ensure_ascii=False))
