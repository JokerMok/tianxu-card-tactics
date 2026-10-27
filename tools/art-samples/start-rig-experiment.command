#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export TIANXU_HOST=127.0.0.1 TIANXU_PORT=7462
export TIANXU_DATABASE="$PWD/.local/rig-experiment/data/game.sqlite"
export TIANXU_LOG_DIR="$PWD/.local/rig-experiment/logs"
export TIANXU_WEB_DIR="$PWD/.local/rig-experiment/web"
export TIANXU_ART_DIR="$PWD/.local/rig-experiment/art"
exec node scripts/start-game.mjs
