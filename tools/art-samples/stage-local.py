"""Stage an already completed native Cocos build. Local QA only; never packages a DB."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess
p=argparse.ArgumentParser();p.add_argument('--build-root',required=True);p.add_argument('--output',help='Optional isolated local preview directory');p.add_argument('--source-overlay');p.add_argument('--diagnostics',action='store_true');opt=p.parse_args()
root=Path(__file__).resolve().parents[2];b=Path(opt.build_root).resolve();w=Path(opt.output).resolve() if opt.output else root/'.local/art-samples/web';w.mkdir(parents=True,exist_ok=True)
if not opt.diagnostics:
 assert not any((w/name).exists() for name in ['art-observe.js','art-record.js','player-profile.js']), 'Formal staging needs a clean output directory; preserve the previous QA build and select --output.'
web=b/'project/build/web-desktop'
settings=json.loads((web/'src/settings.json').read_text())
assert settings.get('scripting',{}).get('scriptPackages') and settings.get('launch',{}).get('launchScene'),'Incomplete Cocos build: missing scene/script package'
assert 'TianxuGame.ts' in (web/'assets/main/index.js').read_text(),'Incomplete Cocos script bundle'
files=json.loads((b/'entry-dependencies.json').read_text());records={}
for f in files:
 source=Path(opt.source_overlay)/f if opt.source_overlay and (Path(opt.source_overlay)/f).is_file() else root/'cocos-client'/f
 data=source.read_bytes();assert data==(b/'project'/f).read_bytes(), 'Stale build: '+f
 records[f]=hashlib.sha256(data).hexdigest()
shutil.copytree(b/'project/build/web-desktop',w,dirs_exist_ok=True)
if opt.diagnostics:
 for name in ['observe','record']:shutil.copy2(root/f'tools/art-samples/{name}.js',w/f'art-{name}.js')
 shutil.copy2(root/'tools/art-samples/player-profile.js',w/'player-profile.js')
 p=w/'index.html';s=p.read_text().replace('<script>\n    System.import','<script src="player-profile.js"></script>\n<script>\n    System.import');s=s.replace('</body>','<script src="art-record.js"></script><script src="art-observe.js"></script></body>');p.write_text(s)
(w/'release.json').write_text(json.dumps({'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'bundleSha256':hashlib.sha256((w/'assets/main/index.js').read_bytes()).hexdigest(),'sourceHashes':records,'artPackHashes':{str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for version in ['v2','v3','v4','v5'] for f in (root/f'cocos-client/assets/resources/art-samples/{version}').glob('*') if f.is_file()},'build':'Cocos Creator 3.8.8 native web-desktop','sourceState':'local art integration; exact source hashes above'},ensure_ascii=False,indent=2))
print('Staged',len(files),'verified current source files:',w)
