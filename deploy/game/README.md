# 天墟游戏独立运行包

本目录用于把已有 Cocos Web 构建与 Node 权威服务封装为单进程、单容器的 Linux 运行时。它不会重建 Cocos，也不会生成第二套后端。

## 准备运行包

先用 Cocos Creator 生成已验收的 `.local/web`。打包器只使用显式白名单，并根据当前 `catalog.json` 收集 main 作用域的表、模型、时间线和位图依赖。

```bash
node scripts/package-game-runtime.mjs --dry-run
node scripts/package-game-runtime.mjs --output .local/game-runtime
```

第二条命令要求输出目录不存在，不会覆盖旧包。完成后的 `runtime-manifest.json` 逐文件记录字节数和 SHA-256。数据库、日志、备份、凭据、缓存和整个客户端逆向研究目录不在白名单中。

## 直接运行

运行机需要 Node.js 22.18 或更新版本，因为服务会直接导入经 Node 类型剥离处理的 `.ts` 规则模块。

```bash
cd .local/game-runtime
TIANXU_HOST=127.0.0.1 \
TIANXU_PORT=7400 \
TIANXU_DATABASE=/absolute/persistent-data/tianxu.sqlite \
node scripts/start-game.mjs
```

如果需要另行挂载资源，可设置 `TIANXU_CONTENT_DIR`、`TIANXU_WEB_DIR`、`TIANXU_UI_DIR` 和 `TIANXU_LOCALIZATION_DIR`。`TIANXU_LOG_DIR` 用于指向可写日志目录。这些值在 Linux 上应使用实际绝对路径，不依赖本机 macOS 用户目录。

## Docker Compose

首次启动前创建配置目录和三个独立的可写目录，并将 `.env` 的 `TIANXU_UID` / `TIANXU_GID` 设为这些目录的拥有者（用 `id -u` / `id -g` 查看）。默认1000适用于常见Linux用户，macOS通常不同；不要放宽个人库权限来迁就容器。

```bash
mkdir -p .local/deploy/config .local/deploy/data .local/deploy/logs .local/deploy/backups
cp deploy/game/.env.example deploy/game/.env
docker compose --env-file deploy/game/.env -f deploy/game/compose.yaml up --build -d
```

Compose 默认只将服务发布到宿主机 `127.0.0.1:7400`。容器内部监听 `0.0.0.0`，只是为了接收 Docker 端口转发；它不等于公网发布。检查就绪状态：

```bash
curl --fail http://127.0.0.1:7400/api/health
docker compose --env-file deploy/game/.env -f deploy/game/compose.yaml ps
```

更换运行包时先备份数据库，再在新目录生成新包和新镜像。回滚前先确认数据库兼容性；本轮 GM 为附加表迁移，切回上一版本不需要覆盖数据库。禁止用旧备份覆盖上线后玩家进度。不要把数据库、日志或备份复制进 `.local/game-runtime`。

当前为无需邀请码的玩家注册版本，账号 Bearer 鉴权继续生效。GM 后台和首次管理员初始化见 [gm.md](gm.md)。生产必须设置准确的 `TIANXU_PUBLIC_ORIGIN` 与可信反代 socket 地址 `TIANXU_TRUSTED_PROXY`；Caddy 覆盖 X-Real-IP。旧 [tencent.md](tencent.md) 的邀请码要求仅保留为历史记录，已被本轮替代。
