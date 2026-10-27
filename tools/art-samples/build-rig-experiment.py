#!/usr/bin/env python3
"""Package complete repainted cutout parts. Never cut limbs from whole poses."""
import argparse, hashlib, importlib.util, json, time
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'art-source/rig-experiment'
OUT=ROOT/'cocos-client/experiments/rig/resources'
loader=importlib.util.spec_from_file_location('batch',ROOT/'tools/art-samples/produce-batch.py')
module=importlib.util.module_from_spec(loader);loader.loader.exec_module(module)
NAMES=['head','torso','pelvis','cloth','swordUpper','swordFore','shieldUpper','shieldFore','backThigh','backShin','frontThigh','frontShin','weapon','shield','shieldEdge','bowedHead']
SIZES=[(20,23),(33,31),(26,12),(25,13),(15,18),(13,17),(15,18),(13,17),(16,18),(17,19),(16,18),(17,19),(11,38),(25,34),(12,34),(20,21)]
ANCHORS=[(.5,.14),(.5,.12),(.5,.65),(.5,1),(.5,.9),(.5,.9),(.5,.9),(.5,.9),(.5,.94),(.36,.94),(.5,.94),(.36,.94),(.5,.15),(.5,.5),(.5,.5),(.5,.14)]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def parts(sheet):
 im=Image.open(sheet).convert('RGBA');w,h=im.size
 components=module.alpha_components(im,threshold=24)
 large=[c for c in components if len(c)>1000]
 if len(large)!=16:raise ValueError(f'{sheet}: expected16 fully separated parts, got{len(large)}; repair source, do not rectangle-slice anatomy')
 result={}
 for c in large:
  xs=[v%w for v in c];ys=[v//w for v in c]
  box=(min(xs),min(ys),max(xs)+1,max(ys)+1)
  col=min(3,int(((box[0]+box[2])/2)/w*4));row=min(3,int(((box[1]+box[3])/2)/h*4));index=row*4+col
  if index in result:raise ValueError('Part layout ambiguous; source needs adjustment')
  result[index]=(im.crop(box),box)
 return result

def build(trial=False):
 started=time.perf_counter();OUT.mkdir(parents=True,exist_ok=True)
 labels=['trial']if trial else ['guard','squire']
 atlas=Image.new('RGBA',(1024,256 if trial else 512))
 costumes={};records=[]
 original=json.loads((ROOT/'cocos-client/assets/resources/art-samples/v5/manifest.json').read_text())
 for ci,label in enumerate(labels):
  source=SRC/f'{label}-parts-source.png';extracted=parts(source);slots={}
  for i,name in enumerate(NAMES):
   part,box=extracted[i];size=SIZES[i]
   if label in ['squire','trial']and name in ['shield','shieldEdge']:size=(27,30)if name=='shield'else(12,30)
   # Resolution is tied to displayed size at2.5 texels/design px, not cell size.
   width,height=[round(v*2.5)for v in size]
   part=part.resize((width,height),Image.Resampling.LANCZOS)
   idx=ci*16+i;x=(idx%8)*128+3;y=(idx//8)*128+3
   atlas.alpha_composite(part,(x,y));slots[name]={'rect':[x,y,width,height],'size':size,'anchor':ANCHORS[i]}
   records.append({'costume':label,'part':name,'source':str(source.relative_to(ROOT)),'sourceBounds':box,'runtimeRect':[x,y,width,height],'fullyRepainted':True})
  key='main:monster:'+('1'if label=='guard'else'19')
  costumes[label]={'parts':slots,'origin':[0,-32],'nameOffsetY':56,'height':81,'sourceMonsterId':1 if label=='guard'else 19,'clips':original['units'][key]['clips']}
  if 'reactions' in original['units'][key]:costumes[label]['reactions']=original['units'][key]['reactions']
 temp=OUT/('trial-parts.webp'if trial else'parts.webp');atlas.save(temp,lossless=True,method=6)
 target=OUT/(("trial-"if trial else'')+'parts-'+sha(temp)[:12]+'.webp');temp.rename(target)
 result={'version':1,'id':'rig-reuse-experiment','atlas':target.name,'atlasSize':list(atlas.size),'costumes':costumes,'motion':'shared-humanoid-v1','resolution':'2.5 texels/design px; no GPU residency claim'}
 if not trial:
  # A real lossless whole-pose packing comparator, same source pixels/anchors.
  combined=Image.new('RGBA',(194*6,157*11));packed={};offset=0
  for label,mid in [('guard',1),('squire',19)]:
   spec=original['units'][f'main:monster:{mid}'];im=Image.open(ROOT/'cocos-client/assets/resources/art-samples/v5'/spec['atlas']).convert('RGBA');fw,fh=spec['frameSize']
   for f in range(spec['frameCount']):
    cell=im.crop(((f%6)*fw,(f//6)*fh,(f%6+1)*fw,(f//6+1)*fh));dest=((offset+f)%6*194,(offset+f)//6*157);combined.alpha_composite(cell,dest)
    assert combined.crop((dest[0],dest[1],dest[0]+fw,dest[1]+fh)).tobytes()==cell.tobytes()
   packed[label]=dict(spec,frameSize=[194,157],frameCount=65,displaySize=[194*.6640625,157*.6640625],clips={k:dict(v,start=v['start']+offset)for k,v in spec['clips'].items()})
   if 'reactions'in spec:packed[label]['reactions']={k:dict(v,start=v['start']+offset)for k,v in spec['reactions'].items()}
   offset+=spec['frameCount']
  p=OUT/'packed.webp';combined.save(p,lossless=True,method=6);dest=OUT/('packed-'+sha(p)[:12]+'.webp');p.rename(dest)
  for spec in packed.values():spec['atlas']=dest.name
  result['packed']=packed
 (OUT/('trial.json'if trial else'manifest.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 (SRC/('trial-registration.json'if trial else'registration.json')).write_text(json.dumps({'method':'Connected alpha silhouettes from COMPLETE GENERATED PARTS, not rectangular limb crops from poses. Bounding boxes trim transparent margins only.','parts':records,'sourceHashes':{f'{label}-parts-source.png':sha(SRC/f'{label}-parts-source.png')for label in labels},'buildSeconds':time.perf_counter()-started},ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'costumes':labels,'atlas':target.name,'decodedBytes':atlas.width*atlas.height*4,'runtimeBytes':target.stat().st_size,'buildSeconds':time.perf_counter()-started}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--trial',action='store_true');args=p.parse_args();build(args.trial)
