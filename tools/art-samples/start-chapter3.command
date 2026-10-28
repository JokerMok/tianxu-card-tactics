#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ! -f .local/chapter3-normal/game.sqlite || ! -f .local/chapter3-normal/web-formal/index.html ]]; then
  echo '缺少本轮隔离数据库或正式构建；请复用本机交付目录，不创建或覆盖其他存档。' >&2
  exit 1
fi
export TIANXU_HOST=127.0.0.1 TIANXU_PORT=7469
export TIANXU_DATABASE="$PWD/.local/chapter3-normal/game.sqlite"
export TIANXU_WEB_DIR="$PWD/.local/chapter3-normal/web-formal"
export TIANXU_LOG_DIR="$PWD/.local/chapter3-normal/logs"
exec node scripts/start-game.mjs
