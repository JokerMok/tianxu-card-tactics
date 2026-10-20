# 原版内容接入与本地重建

本目录说明如何从本机完整只读来源重建 recovered 内容，并划分配置、资源、功能和最终验收的证据边界。

当前仓库中的代码、导入工具和说明可以版本管理；完整 recovered 图片、音频、时间线和其他大资源由 Git 忽略。开发机上存在完整来源时可以重新导入；只有 Git 仓库、没有完整来源目录时，不能把项目描述为“克隆后开箱即玩”的完整资源版。

## 来源要求

- Python 3.10+。
- Node 22.18+，当前开发机已使用更高版本运行直接 TypeScript 导入。
- Cocos Creator 3.8.8 的本地工程和构建环境。
- 项目同级的完整只读来源 KingsCall-原版客户端逆向研究/，其中必须包含 client-handoff/ 与 analysis-copy/。
- 固定 source manifest：5254333315581813739。

轻量审阅 ZIP、Git 仓库本身或少量截图均不足以重建完整本地资源。导入器没有网络下载、官方登录、支付或 Steam 订单行为，也不会修改原始来源目录。

## 本地重建

默认从同级完整来源复制实际引用的已转换图片、地图背景、音频和时间线依赖：

    npm run import:original

资料移动后显式指定完整来源根：

    python3 scripts/import-kings-call.py --source '/完整逆向项目根目录'

只生成配置、关联和时间线元数据，不复制大量资源：

    python3 scripts/import-kings-call.py --resources none
    npm run verify:content

输出位于 cocos-client/assets/resources/recovered/，并由 Git 忽略。主要文件：

- catalog.json：main/media 独立目录，含卡牌、怪物、技能、地图、场景、效果、状态、资源、模型、角色模型和时间线索引。
- tables/<scope>/<稳定配置ID>.json：435 份表按稳定 ID 保存，不按 basename 合并；保留原字段、XML 标签、_path 与稳定行 ID。
- images/、audio/ 等：只复制配置和模型实际引用且已有转换结果的资源。
- import-report.json：导入统计、来源缺口、资源关联和错误；它不是玩法验收报告。
- RecoveredContent.ts：客户端和服务端共用的读取层，负责命名空间、地图网格、场景图、触发器和等级数据。

## 当前内容范围

2026-10-20 的元数据报告为 documentation/recovery/content-check.json：

| 范围 | 卡牌记录 | 怪物 | 技能 | 地图 | 场景 | 节点 | 触发器 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | 9,320 | 8,265 | 728 | 68 | 95 | 423 | 1,129 |
| media | 6,820 | 5,707 | 462 | 26 | 42 | 245 | 704 |

这些是配置记录数。main 与 media 是两个版本范围，不能相加成独立可玩内容。

main 的普通召唤卡进一步按未废弃、Type=1、MonsterID>0 且怪物可解析筛选，当前为 6,289 张。视觉验证要求它们具有匹配卡图、运行时怪物模型和至少一条可播放 stand 时间线。该结论来自现有导入结果与验证脚本，最终仍需在当前整合 HEAD 上重跑。

main 的技能视觉链为：

Skill.xml → catalog visualModels → Resources_xml5.xml 的 magicitem/effect.animatename → Resources_xml13.xml emitter → 精确 SWF 容器与导出 symbol → timeline → 位图依赖。

当前 730 个技能模型引用中有 717 个取得真实 timeline，覆盖 602 个技能。剩余 13 个引用涉及 baofengxue_status、shihuashu_status 两个没有 animatename 的状态模型。另有 116 个主库技能没有 visualModels，10 个技能只引用上述不可播放状态模型。因而可以说“602 个技能已有关联的真实动画时间线”，不能说“728 个技能全部有动画”。

玩家英雄不回退到怪物或卡面：4 个职业×2 个性别均通过 actor.xml/actorItems 得到 body+weapon 双层模型。怪物角色链按 MonsterID → animateitem → items 模型 → status timeline → display list → bitmap fill 恢复。

## 地图、怪物与场景兼容

恢复层保留原始数据，同时把运行时适配写入报告：

- main 有 18 条悬空边，继续作为 source gap 保存，不生成不存在的目标节点。
- 原起点不可达的 18 个节点经核对均是独立副本首战节点；运行时增加可选副本入口，使 423 个已导入节点均可达。这个入口是适配，不是原始边。
- `scene/scenes` 有 117 条配置：95 个保留原始导入场景图，22 份源 XML 确认缺失。运行时通过 `backend/game/scene-compatibility.mjs` 显式追加 22 个本地重建场景，因此可解析场景总数为 117；重建项带来源模板与理由，不计入原始恢复数量。
- 缺失怪物 61152、65601、5901010 显式映射到 60152、65611、590110，并保留 sourceMonsterId。
- 2501、2502、2503 没有敌人 param，按棋盘清场模式运行。
- 源地图 12 和场景 2503 引用的地图 14 缺布局；相关实例使用地图 1 兼容布局，同时保存 sourceMap/effectiveMap。content-check.json 仍报告两个 main 地图布局缺口。
- 普通召唤只用卡表 MonsterID。MonsterID=0 的英雄/展示记录不按同值卡牌 ID 猜测怪物。

campaign-check.json 已验证 1,111 个普通配置和 13 个精英配置可创建权威战斗，并将 138 个代表组推进到结算；新账号通过真实 HTTP 动作推进到第 2 章。它不等于 19 章逐关真人通关。

## 当前运行路径

- scripts/start-game.mjs：启动本机 HTTP 服务、SQLite 和静态 Cocos Web。
- backend/game/scene-compatibility.mjs：从恢复表生成 22 个显式本地场景扩展；Tome Hall 使用独立递进倍率，季节副本沿用真实地图、敌方模型和奖励预览入口，6301 仅按“无蓝方”来源语义启用清场 board。该模块可重复调用，已存在扩展时返回空结果。
- backend/game/server.mjs、store.mjs、service.mjs：本地账号、会话、事务幂等、状态、房间、战斗和结算。
- backend/game/growth-systems.mjs：成长、装备、商城、仓库、活动、战令、召唤与本地支付替代。
- backend/game/social.mjs：好友、聊天、邮件、公会、交易和拍卖。
- backend/game/pve-systems.mjs：塔、世界 Boss、禁地、任务、探索、宠物岛及跨模块任务钩子。
- backend/game/competition-systems.mjs：图鉴、开包构筑竞技赛和原版称号。
- backend/game/league-systems.mjs：北京时间周天梯、公会城战、排名和领奖。
- cocos-client/assets/scripts/game/BattleKernel.ts：客户端与服务端共用的权威战斗状态机。
- cocos-client/assets/scripts/game/TianxuGame.ts：主城、世界、社交、房间、动态成长菜单和战斗画面。
- RecoveredAnimation.ts、RecoveredEffects.ts：原时间线角色和技能特效播放。

原服务端源码没有恢复。随机、AI、伤害顺序、奖励、Elo、支付替代和部分活动概率属于本地自主权威规则；详见项目根 `IMPLEMENTATION_DECISIONS.md` 及本目录各 decisions 文档。TypeID 39 光环代理已完成定向验证 27/27，当前正式入口最终全量回归已通过。

## 已有验证与边界

| 证据 | 已证明 | 未证明 |
| --- | --- | --- |
| content-check.json | 435 表哈希/结构、命名空间、引用、地图和图缺口 | 资源运行、玩法完成 |
| scene-compatibility.test.mjs | 22 个本地场景的图结构、地图、敌人、奖励入口、稳定 ID、Tome 递进和幂等重建 | 22 份缺失源 XML 的原始内容、最终全量回归 |
| campaign-check.json | 战役配置创建、代表组结算、新账号 HTTP 推进 | 全章节逐关真人通关 |
| integration-check.json / integration.test.mjs | 双账号隔离、资产守恒、合作、天梯、幂等与重启恢复 | 2v2/4v4、多客户端画面、完整模块矩阵 |
| multiplayer-variants.test.mjs | 临时 SQLite/真实 HTTP 下 8 账号的 2v2、4v4、全员操作、奖励和结算幂等 | 两个以上真实 Cocos 客户端的网络/UI 体验 |
| growth/pve/competition/league tests | 对应自主规则、源配置门槛、失败回滚和防重复 | 每种组合的浏览器操作 |
| verify-recovered-visuals.mjs | 6,289 有效召唤卡资源条件、角色动画、技能动画样本与构建新旧关系 | 所有角色/技能在真实浏览器中的逐帧画面 |
| 现有浏览器记录 | 主城、地图、首关、选牌、部署和部分动画进入真实页面 | 最终整款 UI、音频和双客户端联机验收 |

资料、配置和资源数量本身不能证明功能完成；测试通过也不能自动证明最终浏览器体验。

## 等级、建筑、支付和周赛说明

- ActorLevelInfo.xml 原始行只到 Level 94。为满足启用任务和本地盟约的 100 级条件，95–100 按最后一条源记录外推经验与属性，明确标为本地兼容扩展。
- 五类任务建筑均可升到 20 级，满足源任务最高门槛；完整原服城建公式缺失，成本与计时为本地规则。
- 不连接第三方支付、官方充值或 Steam 订单。每日测试补给有上限；原周充/额外奖励改为累计 7/20 次真实养成操作后每周一次的本地补给。充值任务只统计实际增加的本地金币。
- 天梯单场使用 K=32 Elo；周赛按北京时间周一结算，新周软重置保留相对 1000 分的一半偏差。该算法属于明确的本地服务端规则。

## 最终回归

最终整合完成后执行：

    node scripts/verify-game.mjs

该入口应对当前 HEAD 依次运行内容校验、全部后端/战斗测试、Cocos strict 检查和恢复视觉校验，并写出 documentation/recovery/final-regression.json。最终收口线程还需补真实浏览器主城/地图/战斗/音频/结算和双客户端合作/PVP 证据。

最终正式入口回归通过，见 [final-regression.json](final-regression.json)（106项规则/HTTP/多人/事务检查以及严格类型、内容与视觉检查）。战役报告为 source95/runtime117，1133普通、13精英实例与156代表结算通过；新账号正常推进到第2章。真实双Cocos客户端、技能飞牌与命中、头像、升级及重启恢复记录见 [ui-check.md](ui-check.md)。提交与远端SHA以本次Git交付核对为准。
