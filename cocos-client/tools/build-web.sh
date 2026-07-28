#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CREATOR_APP="${COCOS_CREATOR_APP:-$HOME/Applications/CocosCreator-3.8.8/CocosCreator.app}"

if [[ ! -x "$CREATOR_APP/Contents/MacOS/CocosCreator" ]]; then
  echo "Cocos Creator executable not found: $CREATOR_APP" >&2
  exit 1
fi

"$CREATOR_APP/Contents/MacOS/CocosCreator" \
  --project "$PROJECT_DIR" \
  --build "platform=web-desktop;debug=false"
status=$?

# Creator documents exit code 36 as a successful command-line build.
if [[ $status -eq 36 ]]; then
  exit 0
fi
exit "$status"
