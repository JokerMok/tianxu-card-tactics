#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TIANXU_HOST=127.0.0.1 TIANXU_PORT=7468
export TIANXU_DATABASE="$PWD/.local/chapter2-normal/game.sqlite"
export TIANXU_WEB_DIR="$PWD/.local/chapter2-normal/web-formal"
export TIANXU_LOG_DIR="$PWD/.local/chapter2-normal/logs"
exec node scripts/start-game.mjs
