#!/usr/bin/env python3
"""Inject archived rig code into an isolated build only; never modify formal sources."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
out=Path(args.output).resolve();allowed=ROOT/'.local/rig-experiment'
assert out.is_relative_to(allowed) and not out.is_symlink(), 'Overlay must stay in .local/rig-experiment'
source=ROOT/'cocos-client/experiments/rig'
expected=json.loads((source/'overlay-source-hashes.json').read_text())
for name,digest in expected.items():
 assert hashlib.sha256((ROOT/'cocos-client/assets/scripts/game'/name).read_bytes()).hexdigest()==digest, 'Archived patch base changed; review and regenerate overlay patches: '+name
game=out/'assets/scripts/game';game.mkdir(parents=True,exist_ok=True)
entry=out/'assets/scripts/a0/BattleA0Bootstrap.ts';entry.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/'BattleA0Bootstrap.ts',entry)
for name in ['RigComparisonScene','SharedRigAnimation','SharedRigMotion']:
 text=(source/(name+'.ts')).read_text().replace('../../assets/scripts/game/','./')
 (game/(name+'.ts')).write_text(text);shutil.copy2(source/(name+'.ts.meta'),game/(name+'.ts.meta'))
for name in ['RecoveredAnimation.ts','SampleUnitAnimation.ts']:
 shutil.copy2(ROOT/'cocos-client/assets/scripts/game'/name,game/name)
 subprocess.run(['patch','--batch','--fuzz=0','-p1','-d',str(game),'-i',str(source/(name+'.patch'))],check=True)
art=allowed/'art';formal=ROOT/'cocos-client/assets/resources/art-samples'
for name in json.loads((ROOT/'deploy/game/resource-manifest.json').read_text())['art']['files']:
 target=art/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(formal/name,target)
shutil.copytree(source/'resources',art/'rig-experiment',dirs_exist_ok=True)
print('Isolated archived rig overlay ready; formal source files unchanged.')
