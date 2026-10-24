#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TIANXU_HOST=127.0.0.1 TIANXU_PORT=7440
export TIANXU_DATABASE="$PWD/.local/art-samples/game.sqlite"
export TIANXU_LOG_DIR="$PWD/.local/art-samples/logs"
export TIANXU_WEB_DIR="$PWD/.local/art-samples/web"
exec node scripts/start-game.mjs
