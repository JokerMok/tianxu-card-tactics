#!/usr/bin/env python3
"""Summarize measured native Cocos runs and reproducible two-character payloads."""
from pathlib import Path
from PIL import Image
import gzip, hashlib, io, json, zipfile

ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'cocos-client/assets/resources/art-samples'
DOC=ROOT/'documentation/art-samples/rig-experiment'
OUT=ROOT/'.local/rig-experiment/packages';OUT.mkdir(parents=True,exist_ok=True)
old=json.loads((ART/'v5/manifest.json').read_text())
rig=json.loads((ART/'rig-experiment/manifest.json').read_text())
base={key:old['units'][key] for key in ['main:monster:1','main:monster:19']}
groups={
 'frames':(ART/'v5',list({s['atlas'] for s in base.values()}),{'units':base}),
 'packed':(ART/'rig-experiment',list({s['atlas'] for s in rig['packed'].values()}),{'units':rig['packed']}),
 'rig':(ART/'rig-experiment',[rig['atlas']],{k:v for k,v in rig.items() if k!='packed'})}
data={'scope':'two appearances only; same background/engine/UI excluded from all payloads; ZIPs contain resources, not the complete game',
      'environment':{'date':'2026-10-27','machine':'Apple M5 Pro / 48 GiB / macOS 26.6.2','engine':'Cocos Creator 3.8.8 web-desktop','browser':'ChatGPT in-app Chromium','viewport':[1280,720],'canvasBacking':[2560,1440],'design':[1200,600],'designScale':1280/1200,'devicePixelRatio':2,'sample':'one warm 18-second run per mode, 24 actors, first 0.8 s excluded; no recording during timing; not a stress test'},'variants':{}}
for mode,(folder,names,manifest) in groups.items():
 files=[folder/n for n in sorted(names)]
 archive=OUT/(mode+'-two-characters.zip')
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for name,content in [('manifest.json',json.dumps(manifest,separators=(',',':')).encode())]+[(f.name,f.read_bytes()) for f in files]:
   info=zipfile.ZipInfo(name,(2026,10,27,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,content)
 evidence=json.loads((DOC/f'evidence/{mode}-24.json').read_text())
 assert not evidence['measuring'] and evidence['result']['seconds']>=18
 v={'atlasFiles':[str(p.relative_to(ROOT)) for p in files],'atlasCount':len(files),'textureDownloadBytes':sum(p.stat().st_size for p in files),'baseRGBABytes':sum(Image.open(p).width*Image.open(p).height*4 for p in files),'resourceZipBytes':archive.stat().st_size,'zipSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'nativeNodes':evidence['nodes'],'native':evidence['result']}
 data['variants'][mode]=v
sources={
 'frames':['art-source/revision-2/guard-painted-sheet.png','art-source/revision-2/guard-walk-sheet.png','art-source/batch-2/squire-poses.png'],
 'rig':['art-source/rig-experiment/guard-parts-source.png','art-source/rig-experiment/squire-parts-source.png']}
data['sourceArt']={mode:{'files':names,'bytes':sum((ROOT/p).stat().st_size for p in names),'scope':'input PNG art only; derived atlases and older rejected iterations not counted twice'} for mode,names in sources.items()}
bundle=(ROOT/'.local/rig-experiment/web/assets/main/index.js').read_text()
data['compiledCode']={}
for label,names in [('rigAdapterAndMotion',['SharedRigAnimation','SharedRigMotion']),('diagnosticScene',['RigComparisonScene'])]:
 chunks=[]
 for name in names:
  start=bundle.index('System.register("chunks:///_virtual/'+name+'.ts"');end=bundle.find('\nSystem.register(',start+1)
  chunks.append(bundle[start:end if end>=0 else None].encode())
 raw=b'\n'.join(chunks);data['compiledCode'][label]={'debugModuleBytes':len(raw),'gzipBytes':len(gzip.compress(raw,mtime=0)),'scope':'actual built modules; existing shared helpers and small integration call sites excluded; diagnostic scene is not needed by a future production rig'}
data['thirdAppearance']={'scope':'same-proportion Squire training outfit, no new gameplay ID or other 17 model changes','sourcePNGBytes':(ROOT/'art-source/rig-experiment/trial-parts-source.png').stat().st_size,'runtimeTextureBytes':(ART/'rig-experiment'/json.loads((ART/'rig-experiment/trial.json').read_text())['atlas']).stat().st_size,'baseRGBABytes':1024*256*4,'newMotionTracks':0,'generatorWallMs':json.loads((ROOT/'art-source/rig-experiment/cost-log.json').read_text())['thirdGeneratorWallMs']}
(DOC/'comparison.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for k,v in data['variants'].items():print(k,{f:v[f] for f in ['textureDownloadBytes','baseRGBABytes','resourceZipBytes','nativeNodes']})
print('code',data['compiledCode']);print('sources',data['sourceArt'])
