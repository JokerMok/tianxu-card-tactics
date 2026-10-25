"""Pack only the six approved chapter-1 model sheets. Original resources immutable."""
from pathlib import Path
from PIL import Image,ImageFilter,ImageChops
from statistics import median
import json,hashlib
root=Path(__file__).resolve().parents[2];src=root/'art-source/chapter1-batch3';out=root/'cocos-client/assets/resources/art-samples/v4';out.mkdir(parents=True,exist_ok=True)
batch=json.loads((src/'batch.json').read_text());manifest=json.loads((out.parent/'v3/manifest.json').read_text());manifest['id']='steelwood-chapter1-batch3-20261025'
for image in manifest['images'].values():image['file']='../v3/'+image['file']
for unit in manifest['units'].values():unit['atlas']='../v3/'+unit['atlas']
def components(im):
 w,h=im.size;a=bytearray(im.getchannel('A').point(lambda x:255 if x>40 else 0).tobytes());parts=[]
 for k in range(w*h):
  if not a[k]:continue
  q=[k];a[k]=0
  for z in q:
   x=z%w
   for j in (z-1 if x else -1,z+1 if x<w-1 else -1,z-w,z+w):
    if 0<=j<w*h and a[j]:a[j]=0;q.append(j)
  if len(q)>500:parts.append(q)
 return parts
records={}
for item in batch['units']:
 name=item['key'];im=Image.open(src/(name+'-poses.png')).convert('RGBA');w,h=im.size
 mounted=name=='horseman';frame=320 if mounted else 256;display=200 if mounted else 190 if name.startswith('ogre-') else 170
 scale=.85 if mounted else .60 if name=='elven-hunter' else .58 if name.startswith('goblin-') else .65
 # Layout repairs reduce source poses. Compensate once per unit using the six
 # standing silhouettes, preserving battlefield size without per-frame scaling.
 original=src/(name+'-unspaced.png')
 if original.exists():
  old=Image.open(original).convert('RGBA');ow,oh=old.size;op=sorted(components(old),key=lambda p:max(k//ow for k in p))[:6];np=sorted(components(im),key=lambda p:max(k//w for k in p))[:6]
  scale*=median(max(k//ow for k in p)-min(k//ow for k in p)for p in op)/median(max(k//w for k in p)-min(k//w for k in p)for p in np)
 foot=[108 if name=='ogre-marauder' else 124 if name=='ogre-destroyer' else frame//2,280 if mounted else 220];atlas=Image.new('RGBA',(frame*6,frame*5));registered=[];parts=components(im)
 # Keep disconnected dropped blades with the closest body, rather than discarding them.
 extras=[p for p in parts if len(p)<5000];parts=[p for p in parts if len(p)>=5000]
 def box(p):return(min(k%w for k in p),min(k//w for k in p),max(k%w for k in p),max(k//w for k in p))
 for extra in extras:
  a=box(extra)
  def distance(p):
   b=box(p);return max(a[0]-b[2],b[0]-a[2],0)**2+max(a[1]-b[3],b[1]-a[3],0)**2
  min(parts,key=distance).extend(extra)
 # A sheet may have touching prone poses. Split only the source cell boundary,
 # retaining pixels and recording it; never invent a missing action.
 splits=[]
 while len(parts)<30:
  merged=max(parts,key=lambda p:max(k%w for k in p)-min(k%w for k in p));xs=[k%w for k in merged];cuts=[round(w*c/6)for c in range(1,6)if min(xs)+30<round(w*c/6)<max(xs)-30]
  assert cuts,(name,'cannot separate source poses');cut=min(cuts,key=lambda c:abs(c-(min(xs)+max(xs))/2));parts.remove(merged);parts.extend([[k for k in merged if k%w<cut],[k for k in merged if k%w>=cut]]);splits.append(cut)
 assert len(parts)==30,(name,len(parts));parts.sort(key=lambda p:max(k//w for k in p));rows=[sorted(parts[r*6:(r+1)*6],key=lambda p:min(k%w for k in p))for r in range(5)];grounds=[median(max(k//w for k in p)+1 for p in row)for row in rows]
 for row in range(5):
  for col in range(6):
   pixels=rows[row][col];mask=bytearray(w*h)
   for k in pixels:mask[k]=255
   selection=ImageChops.multiply(Image.frombytes('L',(w,h),bytes(mask)).filter(ImageFilter.MaxFilter(5)),im.getchannel('A'));bounds=selection.getbbox();isolated=im.copy();isolated.putalpha(selection);piece=isolated.crop(bounds)
   # Fixed source-column centre and common row-ground, not per-pose recentering.
   source_anchor=[(col+.5)*w/6,grounds[row]]
   piece=piece.resize((round(piece.width*scale),round(piece.height*scale)),Image.Resampling.LANCZOS)
   x=round(foot[0]+(bounds[0]-source_anchor[0])*scale);y=round(foot[1]+(bounds[1]-source_anchor[1])*scale)
   assert min(x,y)>=0 and x+piece.width<frame and y+piece.height<frame,(name,row,col,x,y,piece.size)
   atlas.alpha_composite(piece,(col*frame+x,row*frame+y));registered.append({'action':['stand','walk','atk','hit','die'][row],'frame':row*6+col,'sourceAnchor':source_anchor,'alphaBounds':bounds,'runtimePosition':[x,y]})
 raw=src/(name+'-atlas.png');atlas.save(raw);digest=hashlib.sha256(raw.read_bytes()).hexdigest();filename=name+'-'+digest[:12]+'.png';(out/filename).write_bytes(raw.read_bytes())
 spec={'atlas':filename,'frameSize':[frame,frame],'columns':6,'frameCount':30,'displaySize':[display,display],'foot':foot,'mount':[foot[0],196 if mounted else 178],'origin':[0,-32],'nameOffsetY':68 if mounted else 78 if name.startswith('ogre-') else 56,'clips':{
 'stand':{'start':0,'count':6,'fps':8,'loop':True},'walk':{'start':6,'count':6,'fps':16.666666666666668 if mounted else 13.333333333333334,'loop':True},'atk':{'start':12,'count':6,'fps':3/item['originalCueSeconds'],'cueFrame':3,'loop':False},'hit':{'start':18,'count':6,'fps':20,'loop':False},'die':{'start':24,'count':6,'fps':7.5,'loop':False}}}
 for id in item['monsterIds']:manifest['units']['main:monster:'+str(id)]=spec.copy()
 records[name]={'sourceSize':[w,h],'sourceSha256':hashlib.sha256((src/(name+'-poses.png')).read_bytes()).hexdigest(),'atlasSha256':digest,'scale':scale,'sourceColumnPitch':w/6,'rowGrounds':grounds,'sourceBoundarySplits':splits,'spec':spec,'frames':registered}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(src/'registration.json').write_text(json.dumps(records,ensure_ascii=False,indent=2));print('Packed',len(records),'new model atlases, retaining v3 assets unchanged')
