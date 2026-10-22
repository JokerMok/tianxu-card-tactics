# 单机 Linux 运行时与部署准备

## 交付边界

本轮交付是已有游戏的部署准备：一份 Cocos Web 静态构建、一个现有 Node 权威服务进程、一个 SQLite 数据库。本轮没有创建第二服务，没有公网发布。已在本机 Docker 的 Linux arm64 / Node22.18 容器完成运行、恢复与停止验证；这不代表目标服务器或公网验收。

## 运行合同

| 变量 | 用途 | 容器默认值 |
| --- | --- | --- |
| `TIANXU_CONTENT_DIR` | `catalog.json`、main 表和恢复资源根 | `/srv/tianxu/cocos-client/assets/resources/recovered` |
| `TIANXU_WEB_DIR` | 预构建 Cocos Web 根 | `/srv/tianxu/.local/web` |
| `TIANXU_UI_DIR` | A 修订版 UI 派生资源 | `/srv/tianxu/cocos-client/assets/resources/ui-revision-a` |
| `TIANXU_LOCALIZATION_DIR` | 中文映射目录 | `/srv/tianxu/cocos-client/assets/resources/localization` |
| `TIANXU_DATABASE` | 持久 SQLite 文件 | `/var/lib/tianxu/tianxu.sqlite` |
| `TIANXU_PORT` | HTTP 监听端口 | `7400` |
| `TIANXU_HOST` | HTTP 监听地址 | 直接运行建议 `127.0.0.1`；容器内 `0.0.0.0` |
| `TIANXU_LOG_DIR` | 可写日志目录 | `/var/log/tianxu` |

就绪探针为 `GET /api/health`。停止时 Docker 发送 `SIGTERM`，现有启动器完成 HTTP 停止与 SQLite 关闭；Compose 保留 30 秒宽限。

Node 最低版本为 22.18。服务端依赖 Node 内置 SQLite 和 TypeScript 类型剥离，不需要 `npm install`。运行包中保留 `BattleKernel.ts`、`RecoveredContent.ts`、`GameContracts.ts` 与 `RecoveredEffects.ts`；前三者是服务端规则导入链，`RecoveredEffects.ts` 是已编译客户端特效对应的源契约，服务进程不会直接导入它。

## 资源和可变数据

`deploy/game/resource-manifest.json` 是打包策略。`scripts/package-game-runtime.mjs` 将它展开为精确文件集：

- `backend/game/*.mjs`，排除 `*.test.mjs`；
- 四个列明的 TypeScript 规则/契约文件与现有启动脚本；
- 预构建 `.local/web`；
- `catalog.json`、`original-ui.json`、`item-ui.json`、全部 main 表；
- 从 main scope 出发、经模型与时间线闭包得到的已导入位图/音频；
- `original-ui/` 派生树、`game-zh.json` 和 `ui-revision-a/`。

不包含 media 作用域的表、整个客户端逆向交接目录、导入缓存、测试、文档、个人数据库、账号、密码或令牌。当前恢复目录约 1.0 GiB；最终运行包 `.local/stabilization/runtime` 为30,567个白名单源文件、约969.3MiB；精确逐文件哈希位于包内 runtime-manifest.json。主作用域本身引用了大量动画位图，因此尺寸不能在不缩减当前可用内容的前提下大幅下降。

SQLite 数据、日志和备份分别挂载到 `/var/lib/tianxu`、`/var/log/tianxu` 与 `/var/backups/tianxu`；它们与可再生成的镜像和资源包分开。

## 本机容器验证与目标机边界

最终运行包已实际生成。以官方 Node22.18.0-bookworm-slim 为基底在本机 Docker 构建 Linux arm64 镜像，使用只读根目录、非root用户、仅127.0.0.1端口和独立可写数据/日志/备份目录运行。初次发现 COPY 保留600资源权限导致自定义UID无法读取catalog，已在镜像中统一赋予不可变白名单文件读取权限；未放宽个人库或原件权限。Compose可配置运行UID/GID匹配宿主目录拥有者。

容器实际验证：健康检查、首页、原账号登录、恢复活动战斗后继续PVE胜利、SIGTERM正常退出、重启后卡组/待确认结算/余额不变、容器内一致性备份、恢复到新文件及重复恢复确认。停止约393ms；最终前端bundle哈希与本机一致。见 docker-smoke.json / docker-runtime.json。该测试容器完成后已停止；7420本机隔离游戏继续运行。

目标机仍需核验架构、磁盘、目录拥有者、备份位置和网络边界，再依运行说明顺序启动。没有登录远程服务器、域名配置、外部防火墙变化或公网发布。

## Cocos 构建独立性

Cocos仅在构建机使用，运行机只消费预构建Web与白名单资源。工具链步骤参照[官方命令行构建说明](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)。本机Creator3.8.8直接CLI偶发未注册scene/TypeScript导入器；失败产物未作为最终交付。最终用隔离暂存项目的本地扩展显式 reimport-asset，确认scene导入后调用command-build。22个入口依赖逐字匹配，完整场景和脚本包已由真实浏览器复验；build-source.json记录源码与产物哈希。该临时恢复扩展未安装到全局或正式游戏，也不是运行服务的依赖。后续构建可在Creator打开暂存项目确认资源导入后发布，不能把609字节空脚本包视为构建成功。
