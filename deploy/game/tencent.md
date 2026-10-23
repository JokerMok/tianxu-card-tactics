# 腾讯云邀请内测运维

目标仅为受邀好友内测，部署结果与真实验收记录见本目录 `release-20261023.json` 和 `validation-20261023.md`。不自动合并或推送。原版恢复、候选中文及本版本地形规则的边界沿用 `documentation/stabilization/README.md`。

## 目录与启动

使用 SSH 别名 `tencent-main`；应用根 `/srv/apps/tianxu`，独立 Compose 项目 `tianxu`，宿主回环端口18875。Caddy 由宿主 systemd 管理，只新增 `sites-enabled/tianxu.caddy`，通过既有 `caddy-site-install` 校验并 reload。禁止替换共享 Caddyfile、重启其他项目或全局清理 Docker。

- `releases/<版本>/`：白名单运行包，含 `runtime-manifest.json` 和前端 `.local/web/release.json`。
- `current` / `previous`：运行版本指针，首次部署没有 previous。
- `.env`：镜像版本、绝对持久目录、网络及资源限制。
- `shared/data/tianxu.sqlite`：唯一正式内测库，初次空库初始化，个人/本机测试库不迁移。
- `shared/config/invitations.json`：0600，父目录0700，容器只读；不进镜像或仓库。
- `shared/logs`、`shared/backups`：独立持久目录。

```bash
cd /srv/apps/tianxu
sudo docker compose -p tianxu --env-file .env -f current/deploy/game/compose.yaml ps
sudo docker compose -p tianxu --env-file .env -f current/deploy/game/compose.yaml up -d --no-build
sudo docker compose -p tianxu --env-file .env -f current/deploy/game/compose.yaml stop
```

容器限制768MiB、1CPU、128进程，Node堆512MiB；正常停机30秒，healthcheck及unless-stopped自动恢复。Docker日志10MiB×3，应用日志由主机针对本项目轮转。运行环境由Linux amd64官方Node22.18.0归档与已存在的Ubuntu26.04基础镜像构成，校验官方SHA256后构建，不使用macOS node_modules或ARM镜像。Cocos只在构建机运行。

## 邀请与身份

`TIANXU_BETA_REQUIRED=1`，配置失效时关闭访问。独立 Secure/HttpOnly/SameSite Cookie 覆盖页面、素材和API，只有健康接口无需邀请；不改Bearer身份认证。邀请码有效期和Cookie最长7天分别校验，可撤销邀请使会话立即失效。游戏账号仍需正常注册、建角，不提供默认高权限账号或网页发奖接口。每个邀请入口限速20次/分钟，当前反代下共享socket限额，适合小规模邀请测试。

发放独立邀请码时，在运行容器中执行本地管理CLI（容器配置挂载只读，故使用一次性、同镜像且无网络的管理容器，按用户1000写私有目录）：

```bash
sudo docker run --rm --network none --user 1000:1000 --entrypoint node \
  -v /srv/apps/tianxu/shared/config:/private \
  <当前镜像> scripts/beta-invites.mjs add --config /private/invitations.json \
  --delivery /private/<独立交付文件>.json --id <邀请ID> --days 30
```

通过SSH将交付文件转交给指定好友，再按同CLI `revoke --config /private/invitations.json --id <邀请ID>`撤销；明文不进入聊天、仓库、访问日志或命令行参数。主机配置不开放公开下载。

## 更新、备份、恢复与回退

构建机重新构建Cocos，再运行现有 `scripts/package-game-runtime.mjs --output <新目录>`。上传前验证白名单与摘要；新版本单独目录和镜像，不覆盖旧版本。更新前用当前容器创建一致性快照：

```bash
sudo docker compose -p tianxu --env-file /srv/apps/tianxu/.env -f /srv/apps/tianxu/current/deploy/game/compose.yaml exec -T tianxu \
  node scripts/game-data.mjs backup --database /var/lib/tianxu/tianxu.sqlite --output /var/backups/tianxu/<唯一备份目录>
```

归档与回执保留沿用既有 `game-data.mjs maintain` 的业务唯一性保护和重试窗口，不手工删SQLite行。恢复只指向独立新库，不覆盖活跃库：

```bash
sudo docker compose -p tianxu --env-file /srv/apps/tianxu/.env -f /srv/apps/tianxu/current/deploy/game/compose.yaml exec -T tianxu \
  node scripts/game-data.mjs restore --backup /var/backups/tianxu/<备份目录> --target /var/backups/tianxu/<独立验证库>.sqlite
```

同schema兼容更新：备份→构建新镜像→更新.env的镜像和构建路径→原子切换previous/current→`up -d --no-build`→检查健康和游玩。兼容回退：先备份当前新进度，切回previous和相应.env镜像，再up；持久库不切换、不回灌旧快照。本次schema仍为2。

遇不兼容迁移时须先停本游戏并保留新库，评估向前修复或兼容迁移；不能只切旧镜像，也不能擅自恢复旧库丢弃新玩家进度。首次发布无旧运行版本，必要时停止本游戏或让站点返回维护提示，保留全部数据与配置。
