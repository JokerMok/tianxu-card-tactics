"""Derive runtime assets from preserved generated masters and real Blender renders."""
from pathlib import Path
from PIL import Image
import argparse,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--renders',default='.local/art-samples/model');opt=p.parse_args()
root=Path(__file__).resolve().parents[2];source=root/'art-source/first-batch';dest=root/'cocos-client/assets/resources/art-samples/v1';dest.mkdir(parents=True,exist_ok=True)
Image.open(source/'forest-map-1.png').convert('RGB').resize((1600,800),Image.Resampling.LANCZOS).save(dest/'forest-map-1.jpg',quality=92)
Image.open(source/'card-frame.png').resize((256,352),Image.Resampling.LANCZOS).save(dest/'card-frame.png')
im=Image.open(source/'panel.png').convert('RGBA');box=im.getchannel('A').point(lambda a:255 if a>100 else 0).getbbox();im.crop(box).resize((384,288),Image.Resampling.LANCZOS).save(dest/'panel.png')
im=Image.open(source/'buttons.png').convert('RGBA')
for state,box in zip(['normal','selected','pressed','disabled'],[(52,91,1202,307),(52,364,1202,580),(52,639,1202,855),(53,913,1202,1129)]):im.crop(box).resize((256,56),Image.Resampling.LANCZOS).save(dest/f'button-{state}.png')
frames=sorted((root/opt.renders).glob('[0-9][0-9][0-9]-*.png'));assert len(frames)==54,'Render all five clips first'
atlas=Image.new('RGBA',(2048,1792));records=[]
for i,p in enumerate(frames):
 im=Image.open(p).convert('RGBA');box=im.getchannel('A').getbbox();assert box and box[0]>0 and box[1]>0 and box[2]<256 and box[3]<256,(p,box)
 atlas.paste(im,((i%8)*256,(i//8)*256));records.append({'frame':i,'file':p.name,'alphaBounds':box,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
assert len(set(r['sha256'] for r in records))==54
atlas.save(dest/'guard-atlas.png');(root/'.local/art-samples/evidence/render-frames.json').write_text(json.dumps(records,indent=2))
print('Derived seven UI/background images plus a 54-pose atlas. Original masters unchanged.')
