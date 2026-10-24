# 精简PVE范围版 · 首批美术样板

2026-10-24。本地分支 `codex/art-samples-pve`，从实际HEAD `dbd5434` 继续，包含 `554f265`；原检查点 `b60fe6c` 保留。实施 `784ff78`，名称定位补修 `57e50b0`。不是全量换美术或全游戏验收。没有连接服务器、写个人数据库、推送或合并main；原未跟踪UI评审目录与zip保留。

## 试玩

- [新样板](http://127.0.0.1:7440/?skin=sample)
- [原素材](http://127.0.0.1:7440/?skin=original)
- [只替换背景](http://127.0.0.1:7440/?skin=sample&art=background)、[只替换UI](http://127.0.0.1:7440/?skin=sample&art=ui)、[只替换卫兵](http://127.0.0.1:7440/?skin=sample&art=unit)

切换URL会重载客户端，不回退数据库或进度；**先保存卡组草稿**。这些开关只作用于表现，不改ID、规则和资产。未选中的对象继续使用旧资源。

启动：项目根目录执行 `tools/art-samples/start-local.command`。端口7440只监听本机，隔离库 `.local/art-samples/game.sqlite`。当前普通试玩角色“钢林旅人”来自正常注册/建角，初始卡组完成首关，未发GM资产。也可自行注册新账号。动作与长名检查账号完全独立，未提供管理权限。

## 三类实际结果

| 样板 | 接入范围 | 当前结果 |
|---|---|---|
| 战场背景 | `main:map:1`，正常第一章PVE | 新生成林地/遗迹背景已在正式战斗入口运行；格子、单位逻辑站位、部署区域不变。其他地图保持原背景。 |
| 基础UI | 卡框、基础面板、主要文字按钮四态 | 无字透明/九宫格底板接入共享组件与A版卡组；中文、滚动、固定详情、拖放、草稿、真实保存保留。原书本、卡图、主城及小图标不替换。 |
| 基础兵种 | `main:monster:1`，对应初始卫兵卡 `main:card:1` | 原创建模/骨骼渲染54帧；待机、移动、攻击、非致命受击、死亡与左右镜像已接入真实播放器。普通PVE及独立权威战斗夹具已运行。其他品质卫兵和其他单位继续用旧动画。 |

这是可运行的**候选方向**。卫兵采用较写实的细长体型，与旧版偏夸张比例有差异，面部、比例、尚未单独制作的接地阴影及新旧混用协调程度仍需用户实际体验确认；未据此启动其他兵种制作。

## 对照与录像

以下均为真实Cocos画布，非整页截图点击原型。对照图在相同数据/站位、相同视口下切换皮肤获得，待机姿势所在帧不保证相同。

| 同一状态 | 原素材 | 新样板 |
|---|---|---|
| 卡组4张、相同隔离卡库 | [原图](evidence/ui-original.png) | [新图](evidence/ui-sample.png) |
| 地图1、相同十单位初始站位 | [原图](evidence/battle-original.png) | [新图](evidence/battle-sample.png) |

- [移动、攻击与非致命受击，32秒](evidence/guard-move-attack-hit.mp4)
- [双方朝向及完整致死动作，28秒](evidence/guard-actions.mp4)
- [真实保存后重开](evidence/saved-reopened.png)
- [1200×600](evidence/ui-1200x600.png) / [1440×900](evidence/ui-1440x900.png)
- 原始完整录像在本机 `.local/art-samples/captures/`：`normal-pve.webm`、`fixture-battle.webm`、`death-battle.webm`、`ui-scroll-save.webm`。交付MP4仅截取原录像前段并编码，没有拼接、调速或生成帧；两段战斗是不同夹具，不冒充一场连续战斗。

普通流程使用正常初始卡组，4回合胜利，奖励30银币/6经验/1张精灵猎人。十单位对抗和20条卡牌长名/多技能展示使用明确的隔离夹具，不能据此证明普通成长能够获得所有高阶卡。夹具调用同一 `createBattle`、服务端指令和 `BattlePresentation`，不包含客户端独立伤害逻辑。

## 资料与停止位置

- [验证与性能口径](validation.md)
- [稳定ID映射、尺寸、锚点与动作规范](asset-contract.md)
- [后续主线唯一一次静态依赖核对](mainline-dependencies.md)
- [生成母图/模型来源与加工说明](../../art-source/first-batch/generation-notes.md)
- [运行文件摘要](evidence/asset-hashes.json)

无字UI底板、背景导出和图集播放流程已可复用；批量制作前仍需确认此方向的材质、兵种体型及与旧单位的比例。旧资产兑换、赛事退款、历史奖励、账号支持和超级管理员指定保持独立，本轮没有处理。保留精简范围，未重新开放图鉴或其他暂缓玩法。
