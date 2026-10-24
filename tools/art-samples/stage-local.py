"""Stage an already completed native Cocos build. Local QA only; never packages a DB."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess
p=argparse.ArgumentParser();p.add_argument('--build-root',required=True);opt=p.parse_args()
root=Path(__file__).resolve().parents[2];b=Path(opt.build_root).resolve();w=root/'.local/art-samples/web';w.mkdir(parents=True,exist_ok=True)
files=json.loads((b/'entry-dependencies.json').read_text());records={}
for f in files:
 data=(root/'cocos-client'/f).read_bytes();assert data==(b/'project'/f).read_bytes(), 'Stale build: '+f
 records[f]=hashlib.sha256(data).hexdigest()
shutil.copytree(b/'project/build/web-desktop',w,dirs_exist_ok=True)
for name in ['observe','record']:shutil.copy2(root/f'tools/art-samples/{name}.js',w/f'art-{name}.js')
p=w/'index.html';s=p.read_text();s=s.replace('</body>','<script src="art-record.js"></script><script src="art-observe.js"></script></body>');p.write_text(s)
(w/'release.json').write_text(json.dumps({'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'bundleSha256':hashlib.sha256((w/'assets/main/index.js').read_bytes()).hexdigest(),'sourceHashes':records,'build':'Cocos Creator 3.8.8 native web-desktop','sourceState':'local art integration; exact source hashes above'},ensure_ascii=False,indent=2))
print('Staged',len(files),'verified current source files:',w)
