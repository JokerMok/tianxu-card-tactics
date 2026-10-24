"""Slice generated painted poses; register a constant ground, pack existing atlas contract.
No motion is fabricated here: source contains painted articulated poses; the walk row has a separate lift/plant pass.
Alpha component selection separates neighboring swords without per-frame bbox recentering.
"""
from pathlib import Path
from PIL import Image,ImageFilter
import json,hashlib,shutil
root=Path(__file__).resolve().parents[2];source=root/'art-source/revision-2';dest=root/'cocos-client/assets/resources/art-samples/v2';dest.mkdir(parents=True,exist_ok=True)
im=Image.open(source/'guard-painted-sheet.png').convert('RGBA');w,h=im.size
alpha=im.getchannel('A');remaining=bytearray(alpha.point(lambda x:255 if x>32 else 0).tobytes());components=[]
for index in range(w*h):
 if not remaining[index]:continue
 queue=[index];remaining[index]=0
 for k in queue:
  x=k%w;y=k//w
  for j in (k-1 if x else -1,k+1 if x<w-1 else -1,k-w,k+w):
   if 0<=j<w*h and remaining[j]:remaining[j]=0;queue.append(j)
 if len(queue)>400:components.append(queue)
assert len(components)==30, len(components)
# Register by source sheet's fixed column and row ground, never by moving silhouette bounds.
column_anchors=[129,351,576,799,1029,1258];ground_rows=[227,453,700,931,1115]
ordered={}
for component in components:
 xs=[i%w for i in component];ys=[i//w for i in component]
 row=min(range(5),key=lambda r:abs(max(ys)-ground_rows[r]));cx=(min(xs)+max(xs))/2
 col=min(range(6),key=lambda c:abs(cx-column_anchors[c]));assert (row,col) not in ordered
 ordered[row,col]=component
atlas=Image.new('RGBA',(1536,1536));frames=[];records=[];scale=.60
for row in range(5):
 for col in range(6):
  pixels=ordered[row,col];mask=bytearray(w*h)
  for k in pixels:mask[k]=255
  # Retain original antialiasing around selected component. Does not paint or recolor it.
  selection=Image.frombytes('L',(w,h),bytes(mask)).filter(ImageFilter.MaxFilter(5))
  from PIL import ImageChops
  selection=ImageChops.multiply(selection,alpha)
  isolated=im.copy();isolated.putalpha(selection);box=selection.getbbox();sprite=isolated.crop(box)
  size=(round(sprite.width*scale),round(sprite.height*scale));sprite=sprite.resize(size,Image.Resampling.LANCZOS)
  x=round(128+(box[0]-column_anchors[col])*scale);y=round(220+(box[1]-ground_rows[row])*scale)
  assert x>=0 and y>=0 and x+size[0]<256 and y+size[1]<256,(row,col,x,y,size)
  frame=Image.new('RGBA',(256,256));frame.alpha_composite(sprite,(x,y));frames.append(frame)
  records.append({'status':['stand','walk','atk','hit','die'][row],'frame':col,'sourceBounds':box,'sheetAnchor':[column_anchors[col],ground_rows[row]],'scale':scale,'runtimeBounds':frame.getbbox()})
# Dedicated lift / plant sequence replaces the first conservative shuffle row.
walk=Image.open(source/'guard-walk-sheet.png').convert('RGBA');walking=[]
for row in range(2):
 for col in range(4):
  cell_box=(round(walk.width*col/4),round(walk.height*row/2),round(walk.width*(col+1)/4),round(walk.height*(row+1)/2))
  cell=walk.crop(cell_box);a=cell.getchannel('A');a=a.point(lambda x:0 if x<16 else x);cell.putalpha(a);box=a.getbbox();sprite=cell.crop(box)
  # All eight use one scale and a fixed sheet grid, not a pose's changing bounding box.
  k=.31;anchor=[225,670,1114,1557][col];ground=[433,860][row]
  size=(round(sprite.width*k),round(sprite.height*k));sprite=sprite.resize(size,Image.Resampling.LANCZOS)
  x=round(128+(cell_box[0]+box[0]-anchor)*k);y=round(220+(cell_box[1]+box[1]-ground)*k)
  frame=Image.new('RGBA',(256,256));frame.alpha_composite(sprite,(x,y));walking.append(frame)
  records.append({'status':'revised-walk','frame':row*4+col,'sourceCell':cell_box,'sourceBounds':box,'sheetAnchor':[anchor,ground],'scale':k,'runtimeBounds':frame.getbbox()})
# Block uses alert / forward-shield brace / alert, never the backward wound recoil.
frames=frames[:6]+walking+frames[12:]+[frames[18],frames[19],frames[18]]
assert len(frames)==35
for i,frame in enumerate(frames):atlas.alpha_composite(frame,((i%6)*256,(i//6)*256))
atlas.save(dest/'guard-atlas.png')
Image.open(source/'forest-map-1.png').convert('RGB').resize((1600,800),Image.Resampling.LANCZOS).save(dest/'forest-map-1.jpg',quality=92)
(source/'sprite-registration.json').write_text(json.dumps({'sourceSheet':im.size,'method':'alpha-connected pose extraction, fixed source column/row ground anchors; common scale 0.60 for all poses, including death. No bbox recentering.','records':records},ensure_ascii=False,indent=2))
manifest=json.loads((root/'cocos-client/assets/resources/art-samples/v1/manifest.json').read_text());manifest['id']='steelwood-revision-2-20261024';manifest['images']={'forest-map-1':{'file':'forest-map-1.jpg','size':[1600,800]}}
manifest['units']['main:monster:1'].update({'frameSize':[256,256],'columns':6,'frameCount':35,'foot':[128,220],'mount':[128,178],'origin':[0,-32],'nameOffsetY':56,'reactions':{'block':{'start':32,'count':3,'fps':15,'loop':False}},'clips':{'stand':{'start':0,'count':6,'fps':8,'loop':True},'walk':{'start':6,'count':8,'fps':13.333333333333334,'loop':True},'atk':{'start':14,'count':6,'fps':12,'loop':False,'cueFrame':3},'hit':{'start':20,'count':6,'fps':20,'loop':False},'die':{'start':26,'count':6,'fps':7.5,'loop':False}}})
shutil.copy2(root/'cocos-client/assets/resources/art-samples/v1/panel.png',dest/'panel.png')
manifest['images']['panel']={'file':'panel.png','size':[384,288],'insets':[26,26,24,24]}
ui=source/'ui-manifest.json'
if ui.exists():manifest['images'].update(json.loads(ui.read_text()))
# Immutable filenames prevent an earlier in-session texture cache from pairing with a new layout.
def immutable(file):
 p=dest/file;digest=hashlib.sha256(p.read_bytes()).hexdigest()[:12]
 name=p.stem+'-'+digest+p.suffix;shutil.copy2(p,dest/name);return name
for item in manifest['images'].values():item['file']=immutable(item['file'])
for unit in manifest['units'].values():unit['atlas']=immutable(unit['atlas'])
(dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('Packed painted poses and continuous-ground background into v2. v1 unchanged.')
