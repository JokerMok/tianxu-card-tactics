#!/usr/bin/env bash
set -euo pipefail
SOURCE_PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="${P0_BUILD_ROOT:-$(mktemp -d /private/tmp/tianxu-p0-build-XXXXXX)}"
CREATOR_BIN="${COCOS_CREATOR_BIN:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"
stage_project() {
mkdir -p "$BUILD_ROOT/project"
rsync -a --exclude 'assets/scripts/' --exclude library --exclude temp --exclude build --exclude node_modules --exclude '*.mjs' --exclude '*.mjs.meta' --exclude 'validate-*.ts' --exclude 'validate-*.ts.meta' --exclude 'assets/scripts/battle/runner/' --exclude 'assets/scripts/battle/testsupport/' --exclude 'assets/scripts/battle/performance/' --exclude '*.test.ts' --exclude '*.test.ts.meta' "$SOURCE_PROJECT/" "$BUILD_ROOT/project/"
python3 - "$SOURCE_PROJECT" "$BUILD_ROOT" <<'PYGRAPH'
from pathlib import Path
import re,sys,shutil,json,time
source,root=map(Path,sys.argv[1:]);target=root/'project'
old=target/'assets/scripts'
if old.exists(): shutil.move(str(old),str(root/('previous-scripts-'+str(time.time_ns()))))
queue=[source/'assets/scripts/a0/BattleA0Bootstrap.ts'];seen=set()
while queue:
 file=queue.pop().resolve()
 if file in seen:continue
 seen.add(file)
 relative=file.relative_to(source)
 dest=target/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest)
 meta=Path(str(file)+'.meta')
 if meta.exists():shutil.copy2(meta,Path(str(dest)+'.meta'))
 if file.suffix not in ['.ts','.js']:continue
 text=file.read_text()
 for spec in re.findall(r"(?:from\s*|import\s*\()['\"]([^'\"]+)['\"]",text):
  if spec.startswith('node:'):raise RuntimeError('Node dependency in formal entry: '+str(file))
  if not spec.startswith('.'):continue
  base=file.parent/spec
  choices=[base,Path(str(base)+'.ts'),base/'index.ts']
  dependency=next((v for v in choices if v.is_file()),None)
  if dependency is None:raise RuntimeError('Missing dependency '+spec+' from '+str(file))
  queue.append(dependency)
(root/'entry-dependencies.json').write_text(json.dumps(sorted(str(f.relative_to(source))for f in seen),ensure_ascii=False,indent=2))
PYGRAPH
python3 - "$BUILD_ROOT" <<'PYBUILD'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);scene=json.loads((root/'project/assets/scenes/BattleA0.scene.meta').read_text())['uuid']
(root/'build-config.json').write_text(json.dumps({'platform':'web-desktop','debug':True,'startScene':scene,'scenes':[{'url':'db://assets/scenes/BattleA0.scene','uuid':scene}]}))
PYBUILD
}
stage_project
build_once() {
  set +e
  "$CREATOR_BIN" --project "$BUILD_ROOT/project" --build "configPath=$BUILD_ROOT/build-config.json" > "$BUILD_ROOT/creator.log" 2>&1
  build_status=$?
  set -e
  [[ $build_status == 0 || $build_status == 36 ]]
}
build_complete() {
python3 - "$BUILD_ROOT" <<'PYCHECK'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); web=root/'project/build/web-desktop'
if not (web/'index.html').is_file() or not (web/'src/settings.json').is_file():
    raise SystemExit(1)
settings=json.loads((web/'src/settings.json').read_text())
scripts=settings.get('scripting',{}).get('scriptPackages',[])
scene=settings.get('launch',{}).get('launchScene')
bundle=web/'assets/main/index.js'
if not scripts or not scene or not bundle.is_file() or 'GameShell.ts' not in bundle.read_text():
    raise SystemExit(1)
PYCHECK
}
for attempt in 1 2 3 4; do
  if build_once && build_complete; then
    if [[ "${P0_RECORD_BUILD_LOCATION:-1}" == 1 ]]; then
      printf '%s\n' "$BUILD_ROOT" > "$SOURCE_PROJECT/../.ai-dev/results/p0-build-location.txt"
    fi
    printf 'Build ready: %s\n' "$BUILD_ROOT/project/build/web-desktop"
    exit 0
  fi
  if [[ $attempt != 4 ]]; then
    if [[ $attempt == 2 ]]; then
      printf 'Cocos import/build attempt 2 was incomplete; staging a fresh project.\n' >&2
      mv "$BUILD_ROOT/project" "$BUILD_ROOT/project-incomplete-$attempt"
      stage_project
    else
      printf 'Cocos import/build attempt %s was incomplete; retrying after the asset database warmed.\n' "$attempt" >&2
    fi
    sleep 2
  fi
done
tail -80 "$BUILD_ROOT/creator.log"
printf 'Cocos build incomplete: scene or script bundle was not imported. Log: %s\n' "$BUILD_ROOT/creator.log" >&2
exit 1
