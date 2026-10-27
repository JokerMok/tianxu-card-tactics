#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TIANXU_HOST=127.0.0.1 TIANXU_PORT=7467
export TIANXU_DATABASE="$PWD/.local/player-experience/data/game.sqlite"
export TIANXU_LOG_DIR="$PWD/.local/player-experience/logs-final"
export TIANXU_WEB_DIR="$PWD/.local/player-experience/web-formal"
exec node scripts/start-game.mjs
