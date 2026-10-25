"""Pack two painted unit sheets into the existing SampleUnitAnimation contract.
R2 resources remain immutable. Only stable monster IDs 19 and 43 are appended.
"""
from pathlib import Path
from PIL import Image,ImageFilter,ImageChops
import json,hashlib
root=Path(__file__).resolve().parents[2];src=root/'art-source/batch-2';out=root/'cocos-client/assets/resources/art-samples/v3';out.mkdir(parents=True,exist_ok=True)
def components(image):
 w,h=image.size;remaining=bytearray(image.getchannel('A').point(lambda x:255 if x>40 else 0).tobytes());result=[]
 for index in range(w*h):
  if not remaining[index]:continue
  q=[index];remaining[index]=0
  for k in q:
   x=k%w;y=k//w
   for j in (k-1 if x else -1,k+1 if x<w-1 else -1,k-w,k+w):
    if 0<=j<w*h and remaining[j]:remaining[j]=0;q.append(j)
  if len(q)>500:result.append(q)
 return result
specs={
 'squire':{'monster':19,'frame':256,'display':170,'foot':[128,220],'mount':[128,178],'nameY':56,'scale':.60,'columns':[120,350,579,807,1037,1267],'ground':[230,468,708,944,1124],'walkFps':13.333333333333334,'attackFps':12},
 'lancer':{'monster':43,'frame':320,'display':200,'foot':[160,280],'mount':[165,196],'nameY':68,'scale':.72,'columns':[113,338,565,786,1015,1248],'ground':[252,478,712,944,1125],'walkFps':16.666666666666668,'attackFps':8},
}
m=json.loads((root/'cocos-client/assets/resources/art-samples/v2/manifest.json').read_text());m['version']=2;m['id']='steelwood-batch-2-20261025'
for v in m['images'].values():v['file']='../v2/'+v['file']
for v in m['units'].values():v['atlas']='../v2/'+v['atlas']
records={}
for name,s in specs.items():
 im=Image.open(src/(name+'-poses.png')).convert('RGBA');w,h=im.size;parts=components(im)
 # Squire's last two prone silhouettes touch at one cell boundary in the source.
 # Split only those connected pixels along the fixed source-cell boundary; no drawn poses are invented.
 if name=='squire':
  merged=next(p for p in parts if min(k//w for k in p)>1000 and max(k%w for k in p)-min(k%w for k in p)>350)
  parts.remove(merged);parts.extend([[k for k in merged if k%w<1147],[k for k in merged if k%w>=1147]])
 assert len(parts)==30,(name,len(parts));ordered={}
 for pixels in parts:
  xs=[k%w for k in pixels];ys=[k//w for k in pixels];row=min(range(5),key=lambda r:abs(max(ys)-s['ground'][r]));col=min(range(6),key=lambda c:abs((min(xs)+max(xs))/2-s['columns'][c]));assert(row,col)not in ordered,(name,row,col)
  ordered[row,col]=pixels
 n=s['frame'];atlas=Image.new('RGBA',(n*6,n*5));frames=[]
 for row in range(5):
  for col in range(6):
   mask=bytearray(w*h)
   for k in ordered[row,col]:mask[k]=255
   selection=ImageChops.multiply(Image.frombytes('L',(w,h),bytes(mask)).filter(ImageFilter.MaxFilter(5)),im.getchannel('A'));b=selection.getbbox();isolated=im.copy();isolated.putalpha(selection);sprite=isolated.crop(b)
   size=[round(sprite.width*s['scale']),round(sprite.height*s['scale'])];sprite=sprite.resize(size,Image.Resampling.LANCZOS)
   x=round(s['foot'][0]+(b[0]-s['columns'][col])*s['scale']);y=round(s['foot'][1]+(b[1]-s['ground'][row])*s['scale']);assert x>=0 and y>=0 and x+size[0]<n and y+size[1]<n,(name,row,col,x,y,size)
   frame=Image.new('RGBA',(n,n));frame.alpha_composite(sprite,(x,y));atlas.alpha_composite(frame,(col*n,row*n));frames.append({'status':['stand','walk','atk','hit','die'][row],'index':row*6+col,'sourceBounds':b,'sourceAnchor':[s['columns'][col],s['ground'][row]],'runtimeBounds':frame.getbbox()})
 raw=src/(name+'-atlas.png');atlas.save(raw);digest=hashlib.sha256(raw.read_bytes()).hexdigest();file=name+'-'+digest[:12]+'.png';(out/file).write_bytes(raw.read_bytes())
 m['units']['main:monster:'+str(s['monster'])]={'atlas':file,'frameSize':[n,n],'columns':6,'frameCount':30,'displaySize':[s['display'],s['display']],'foot':s['foot'],'mount':s['mount'],'origin':[0,-32],'nameOffsetY':s['nameY'],'clips':{'stand':{'start':0,'count':6,'fps':8,'loop':True},'walk':{'start':6,'count':6,'fps':s['walkFps'],'loop':True},'atk':{'start':12,'count':6,'fps':s['attackFps'],'loop':False,'cueFrame':3},'hit':{'start':18,'count':6,'fps':20,'loop':False},'die':{'start':24,'count':6,'fps':7.5,'loop':False}}}
 records[name]={'sha256':digest,'sourceSize':im.size,'method':'Connected pose extraction with fixed source-column and ground registration; common scale per unit, never bbox recentering. Squire final two source poses split at x1147 after alpha contact.','spec':m['units']['main:monster:'+str(s['monster'])],'frames':frames}
(out/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2));(src/'registration.json').write_text(json.dumps(records,ensure_ascii=False,indent=2));print('Packed two units; R2 images and Guard referenced unchanged through v3 manifest.')
