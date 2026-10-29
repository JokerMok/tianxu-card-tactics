# 精简PVE范围版：2026-10-29部署

游戏：<https://tianxu.shizibandu.icu/>；GM：<https://tianxu.shizibandu.icu/gm/>。公开注册保持，无邀请码；未改变管理员身份。用户本轮授权推送与部署，未合并main。

应用提交 `0ca61099f02f0fa073a2930a5f6e15beea68ffe1`，版本 `pve-20261029-0ca6109`。前三章战术/成长实现 `c989d98`；后续资料提交不代表应用重新发布。完整摘要见 [发布记录](release-pve-20261029.json)。

## 本次上线内容

精简PVE范围、A版中文双栏滚动/详情/拖放/真实保存、十九种逐帧角色和原资源回退均随当前代码发布。新战术只用于新开的主线107/203/304：主题牌组、基本部署/移动修复和v2疲劳规则；其他节点及旧战斗保留原版本。第二章探索任务3/6/8个不同节点一次性奖励30/45/65经验，旧领取记录不清空。具体依据与策略对照仍以 [本机验证](../../documentation/pve-experience/README.md) 为准，不把本次部署写成重新验证全部章节。

本次重新用Creator3.8.8构建正式客户端，核验25项源码。补充catalog启动时重新验证缓存，避免一小时旧缓存使新界面读取旧中文/映射。骨架实验、录制诊断、测试夹具、个人库、原始安装包和完整研究目录不入包。

## 实际验证

| 范围 | 结果与边界 |
|---|---|
| Linux镜像 | 在现有amd64基础镜像上覆盖81个实际变化文件；构建内逐项核对30631个运行文件大小与SHA，移除5个不再引用的旧引擎文件。只删除新镜像层中的过期文件，未删原素材或宿主数据。 |
| 旧存档 | 一致性备份恢复到独立库，新应用读取原5账号/5角色；资产、等级、卡组、进度及3场历史/活动战斗摘要不变，1场未结束旧规则战斗保留。首次读取补充阶段兼容信息，schema仍2。 |
| 外网正常账号 | 专用新账号正常注册、建角；初始1/19/43/61卡组真实保存，同请求重试仅计一次；101胜利，30银币、6经验及精灵猎人1，正常结算返回。仅普通玩法，未授GM、改级或注入资产。 |
| 身份边界 | 普通账号GM登录403；test.grant403。既有GM权限结构保留，本次未新增/撤改管理员。 |
| 外网资源 | 标准TLS验证；75个Web/美术文件共24674562字节逐项摘要一致，含十九图集和新正式前端。双请求并行下载耗时34.2秒，这是完整文件校验成本，不是玩家首屏或显存数据。 |
| 重启与防重 | 仅重启tianxu，既有会话、卡组、资产、101胜利与奖励/返回状态一致，未重复发奖。 |
| 备份 | 更新前后均使用应用一致性备份，恢复到独立文件并校验integrity；没有向生产还原旧库。两个备份摘要见发布JSON。 |
| 其他项目 | 另外4容器ID未变，6份Caddy站点摘要未变；Caddy未重载。办公入口302、账号中心200。 |
| 资源采样 | 游戏295.1MiB/768MiB，1CPU上限；宿主磁盘剩2439680000B（约2.27GiB），仍高于既有2GiB底线。没有全局prune或删除旧发布。 |
| 浏览器 | 内置浏览器创建线上页及读取画面连续超时；本轮未完成新的公网Cocos鼠标通关，也没有新公网录屏。当前构建的本机真实Cocos304证据可复用到代码层，不能冒充公网客户端操作。 |

最初资源校验恰遇本游戏重启窗口，出现一次manifest下载失败；就绪后75项重新校验全部一致。发布与重启均存在短暂连接失败/502窗口，不是无停机发布。未做公网压测或全游戏验收。

已脱敏证据位于 [evidence-pve-20261029](evidence-pve-20261029/)。验收账号凭据与原始服务器记录只留本机私有`.local/deploy-20261029/`，不入Git或运行包。

## 日常运行与备份

```sh
cd /srv/apps/tianxu
sudo docker compose -p tianxu --env-file .env -f current/deploy/game/compose.yaml ps
sudo docker compose -p tianxu --env-file .env -f current/deploy/game/compose.yaml up -d --no-build tianxu
```

`current`指向本次release，`previous`指向`public-gm-20261023-107863fa`。数据/日志/备份分别位于`shared/data`、`shared/logs`、`shared/backups`。`.env.previous`及本次release的`env.before`均保存此前public-gm运行配置；更早副本保留，不含于仓库。

当前release是增量构建目录，不是完整源码树。镜像重建使用：

```sh
sudo docker build --network none -f /srv/apps/tianxu/current/Dockerfile.delta \
  -t tianxu-game:pve-20261029-0ca6109 /srv/apps/tianxu/current
```

需保留旧基础镜像`public-gm-20261023-107863fa`。更换来源或增量前须重新核验运行清单，不能把旧阶段`.local/stabilization/runtime`重新发布。

新备份使用唯一目录，示例：

```sh
cd /srv/apps/tianxu
backup_name="manual-$(date -u +%Y%m%dT%H%M%SZ)"
sudo docker compose -p tianxu --env-file .env -f current/deploy/game/compose.yaml exec -T tianxu \
  node scripts/game-data.mjs backup --database /var/lib/tianxu/tianxu.sqlite \
  --output "/var/backups/tianxu/$backup_name"
```

独立恢复继续用`game-data.mjs restore --backup ... --target ...`，目标必须为新文件；不直接复制运行中的SQLite主文件，不把任何备份覆盖线上。

## 回退边界

数据库schema仍2，旧资产不变；**旧镜像不理解tacticsVersion2**。回退必须先检查并解决未结束的v2战斗，而非只切镜像。存在活动v2时保留兼容内核做前向修复，或等其按现有规则正常结算；不得删战斗、强结算或恢复旧库来回退。

以下检查只读取当前库；非零退出时停止回退：

```sh
sudo docker exec tianxu-tianxu-1 node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync("/var/lib/tianxu/tianxu.sqlite",{readOnly:true});
const w=JSON.parse(db.prepare("SELECT json FROM game_world WHERE id=1").get().json);
const n=Object.values(w.battles).filter(b=>!b.settled&&Number(b.state.tacticsVersion??1)>=2).length;
db.close();console.log({activeV2:n});if(n)process.exit(2);'
```

确认没有新v2进行中、已做新的回退前一致备份后，可短停本游戏，用`releases/pve-20261029-0ca6109/env.before`替换当前`.env`，原`.env`另存唯一副本；将`current`原子切回`releases/public-gm-20261023-107863fa`，再以`up -d --no-build tianxu`启动。为避免检查后又产生新战斗，实际切换时先停止游戏，再在该当前镜像挂载的库上重复同样只读检查，通过才切换。回退会丢失本次UI/精简范围/新战术等应用能力，玩家数据库与上线后的进度必须保留。不存在无条件安全的一键回退；不得套用旧文档中回退到6098的邀请码版本。

## 仍保留的限制

仅三个代表关卡采用v2，其他兼容牌池及疲劳收尾问题没有全量调整。用户最终体验、全设备表现及完整复原仍未验收；部分候选中文、历史资产支持事项不因上线而关闭。磁盘空间紧张，下一次较大更新需先按项目归属评估容量，不能直接上传另一份完整资源树。
