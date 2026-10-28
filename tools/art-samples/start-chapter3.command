#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ ! -f .local/chapter3-normal/game.sqlite ]]; then
  echo '缺少本轮隔离数据库；不创建或覆盖其他存档。' >&2
  exit 1
fi
export TIANXU_HOST=127.0.0.1 TIANXU_PORT=7469
export TIANXU_DATABASE="$PWD/.local/chapter3-normal/game.sqlite"
export TIANXU_WEB_DIR="$PWD/.local/chapter3-normal/web-formal"
if [[ ! -f "$TIANXU_WEB_DIR/index.html" ]]; then
  export TIANXU_WEB_DIR="$PWD/.local/chapter3-normal/web"
  echo '使用本轮已有QA构建；战报分页与异步手牌保护待最终原生构建，详见chapter3-normal/README.md。' >&2
fi
[[ -f "$TIANXU_WEB_DIR/index.html" ]] || { echo '缺少本轮客户端构建。' >&2; exit 1; }
export TIANXU_LOG_DIR="$PWD/.local/chapter3-normal/logs"
exec node scripts/start-game.mjs
