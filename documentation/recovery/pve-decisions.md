# PVE 服务端实现决定

## 范围与接口

`backend/game/pve-systems.mjs` 是无异步依赖的权威状态模块。它只依赖调用方传入的 `world`、`actor`、`tables`、`content`、`now` 和 `randomInt`，由外层数据库事务保证失败回滚。

模块导出：

- `pveActions`：可分派操作名。
- `operatePve(ctx, action, payload)`：普通操作返回 `{ action, at, result }`；需要创建战斗时返回 `{ response, start }`。
- `pveView(ctx)`：返回版本化状态、原始日程、任务层级、排行榜和可直接渲染的 `sections`。
- `pveActionSnapshot(ctx)` / `onPveAction(ctx, action, payload, response, before)`：用操作前后的权威状态差量推进养成、商城和社交类任务；操作成功本身不足以计数。
- `onPveBattleSettled(ctx, record, won)`：把已结束战斗写回楼层、共享 Boss、禁地积分和任务计数。
- `tickPve(world, tables, now)`：处理权威时间到期、排名冻结和奖励资格生成。

`start` 是交给现有战斗服务的 `BattleSpec`：

```js
{
  mode, mapId,
  enemies: [{ monsterId, deckId, deckIds, arrangementId, hpMultiplier }],
  allies: [{ cardId }],
  pve: { kind, /* 结算所需的稳定快照 */ }
}
```

调用方创建战斗记录时须将 `start.pve` 保存为 `record.pve`。每个参与角色结算一次，并把该角色放入 `ctx.actor` 后调用 `onPveBattleSettled`。普通剧情记录已有 `level` 与 `mode: pve/coop` 时也会被识别，不要求额外造一个 `record.pve`。结算记录保存已处理角色，重复调用不会重复计数。已有 `GameStore.transaction` 会在 handler 抛错时整体回滚，模块自身不做局部补偿。

## 原始配置映射

### 通天塔

- `TownLayouts.xml` 决定普通塔 1–100 层、地狱塔 501–535 层的区间、怪物池、战斗地图、入场费、刷新费、重置费、银币和经验。
- `Triggers` 及后续 `column_*` 是原客户端的塔层候选编号。普通塔编号可在 `Monster.xml` 逐项验证；地狱塔的 `50001–50058` 在怪物表中不存在，不能直接送入战斗内核。模块保留 `sourceId`，并按楼层进度、候选编号和真实怪物强度做确定性映射；映射池只含生命 1–60、攻击 0–15 的真实 Type 1 怪物。所有最终 `monsterId` 都存在于怪物表，选中候选仍只使用服务端 `ctx.randomInt`。
- `TownGoldPrize.xml` 决定每五层的额外奖励。类型 1、2 分别进入金币、银币；其他原始类型进入独立塔币余额，避免混入现有通用货币。
- 重置价按反编译 `TownConfig` 的累计方式计算：每个已跨越区间的层数乘该区间 `ResetPrice`。

### 世界 Boss

- `WorldBoss.xml` 的首段形成每天 12:00–13:00、19:00–20:00 两场日程；所有时间按固定 UTC+8 日界线解释。
- 原表给出的初始共享生命为 450，阶段 1–4 分别选择对应怪物、地图和三叠牌组。共享状态以 `日期:场次` 为键保存生命、贡献、阶段、击杀者和关闭状态。
- 准入等级 20、四个佣兵及金币价格直接来自配置。雇佣结果只在当前场次生效；战斗内核每队最多四个参与者，玩家占一个位置，因此每场最多雇佣三人，第四次雇佣在扣款前被拒绝。
- 战斗适配层在 `record.damageDealt[actorId]` 写入由内核伤害事件汇总的真实敌方英雄伤害，也可在 `record.pve.damageDealt` 提供同一证据。显式零伤害或缺少统计都记为 0，不按胜负补造伤害，共享生命不会扣成负数。
- 日程关闭时冻结贡献排名并生成可领取资格：所有有正贡献的玩家获得源配置参与档，第一名增加最高贡献档，最终击杀者增加终极击杀档。首杀和累计击杀档缺少对应跨阶段事实，不发放。`worldBoss.reward.claim` 根据源奖励类型发放，并持久化防重键。

### 禁地

- `FiendConfig.xml` 决定 18:30 显示、19:00 开赛、21:00 关闭，以及摆怪 ID `250101002`、额外牌组 `9004`、500% 生命系数、勇者效果、四种灵魂石和次数价格 50。
- 原客户端表没有可恢复的服务端计分公式。当前兼容规则只使用 `Prizes` 段提供的勇者分值：胜利取得配置最高值 6，失败为 0；当天第一次免费，后续次数按配置值 50 扣银币。货币类型在原表中缺失，银币映射保留为本地决定。
- 积分榜读取所有角色持久化积分。积分商店把四种灵魂石作为一次性商品，成本取 `Prizes` 段的勇者显示值；这属于缺少原服接口后的本地映射。
- 21:00 关闭时冻结排名，并按名次映射 `Prize` 段勇者奖励档。导入资料没有 `OnlinePrizeTable.xml`，不能还原原奖池；本地兼容规则保留 `prizeTableId + draws` 审计信息，每次 draw 从 `SoulStoneMSTID` 配置集合中用服务端随机源选一枚并实际写入背包。领取键持久化，重复领取不会再发资产。
- `FiendDeckID` 在原表中是“额外牌组 id”，并非明确的英雄定义。`BattleSpec` 同时保留 `arrangementId`、`deckId` 和兼容 `monsterId`，战斗适配层应优先使用摆怪配置；当前内核无法读取摆怪配置时才使用同 ID 怪物作为本地替代。

### 任务

- 解析 `Task.xml` 的完整 `group → taskitem → task → condition/target/prize → param/fixgoods` 层级，不再使用几条硬编码任务替代源内容。
- `TaskDes.xml` 通过 `desid` 补充描述，并去除旧 Flash 文本标签后输出纯文本。
- 四类 condition 全部实现：最小等级、最大等级、引导步数和前置任务。等级、职业、背包、强化、城建、宠物、声望、好友、公会、塔层、场景触发器、剧情/副本战斗、回合数和真实击杀直接读取现有权威状态；其余跨模块行为读取 `actor.pve.tasks.counters` 的显式事件计数。
- `Task.xml` 与 `TaskDes.xml` 的特殊任务引用已逐项核对：3004 `Propose Marriage` / “Might this be precisely the right time to propose a marriage?”；3005 `Wedding Ceremony` / “Celebrate the event of a lifetime with your beloved in the Wedding Hall.”；3103 `Elite Pack` / “Try your luck with an Elite pack - it could contain exceptional cards!”；3904 `Shuffle` / “Before the start of each PvP battle, you can use Gold to reshuffle and gain a better start.”；3907 `Initial Gold Purchase` / “Recharge a total of 100 gold coins…”。城战空目标还包括 3801–3808、12201–12207、12301–12307，分别引用描述 3800、3801、12200、12300。target 28/29 只有类型说明，没有任何 task 或 group 引用，因此保留解析能力但不虚构源任务。

  | target | 源任务 ID | `Task.xml` target des | `TaskDes.xml` des |
  | --- | --- | --- | --- |
  | 0 | 3004 | `Lead task: interactive task` | `Might this be precisely the right time to propose a marriage?` |
  | 0 | 3005 | `Lead task: interactive task` | `Celebrate the event of a lifetime with your beloved in the Wedding Hall.` |
  | 0 | 3801、3803、3806、3808 | `Lead task: Siege and Defense` | `Enemies can sneak up on you seemingly out of nowhere. Prepare your defences well!` |
  | 0 | 3802、3804、3805、3807 | `Lead task: Siege and Defense` | `Attack is the best defence. Take advantage of it.` |
  | 0 | 12201–12207 | `Daily Quests: Defend City Hall` | `The enemy is always on the watch. Aggressive defence is the only way to maintain status quo.` |
  | 0 | 12301–12307 | `Daily Quests: Invade City Hall` | `Offence is the best defence. Storm the enemy's fort and make them tremble with fear!` |
  | 0 | 3904 | `Shuffle Deck in one PvP Battle` | `Before the start of each PvP battle, you can use Gold to reshuffle and gain a better start.` |
  | 27 | 3907 | `Total charge 100 Gold` | `Recharge a total of 100 gold coins. For more details about the reward, please click the "first recharge" icon below the character avatar.` |
  | 28 | 无任务实例 | 类型注释示例为 `注册正式账号` | 无对应任务描述 |
  | 29 | 无任务实例 | 类型注释示例为 `开包开1张橙色卡片` | 无对应任务描述 |
  | 9 / `baoid=3` | 3103 | `Buy one Elite pack` | `Try your luck with an Elite pack - it could contain exceptional cards!` |
- target 0 的求婚和婚礼接入本地盟约：双方必须是两个真实账号、均达到 100 级，由被邀请方明确接受；仪式由发起方消耗 20 金币，并给双方写入无附件纪念邮件。原始资料未提供仪式价格，20 金币是明确记录的本地兼容价格。城战只由真实城战结算推进。洗牌要求先用 `deck.save` 对同一卡组重排，实际扣除 1 金币并登记；随后只有全部参与者均为独立真实账号、队伍人数平衡的 `pvp`，或真实双账号 `ranked` 战斗成功开局才推进 3904，单独保存卡组不完成任务。
- target 27 的充值任务 3907 在离线版改为“本地补给累计”：`test.grant`、`activity.weeklyGrant`、`activity.rewardBonus` 只按操作后实际增加的金币差额累计，当前不产金币的周补给计数为 0，不按按钮点击伪造充值。界面仍保留原始任务文案，任务进度来自 `localGrantedGold`，累计 100 后可领取原奖励。
- target 28 的本地账号确认只核对当前角色已有的 `accountId` 与角色名，明确返回“未采集证件，未联网认证”；不收集身份证、实名字段或外部认证结果。target 29 按开包后卡牌资产的真实正向差量和源品质记录计数，供将来含该类型的源任务直接使用。
- 任务 3103 的真实目标类型是 target 9、`baoid=3`，不是 target 29。它接入 `kaibao/kaibao.xml` 的 Elite pack：20 级可用，消耗源价格 98 金币，发 6 张未标记废弃且具有有效战斗类型的品质 2–4 卡牌，并保证至少一张品质 3 以上。任务计数只在金币实际减少且卡牌资产实际增加后写入。
- 新增的真实本地任务行动包括：按 `ChuzhengMatou.xml` 锁定条件和最长时间执行限时远征；按 `VipParams.xml` 购买精力和控制强制征税次数；按 `PetIsland.xml` 真实战斗、等待节点刷新后采集；以及消耗两只同品质已有宠物，按 `Pet.xml/Reinid` 生成下一品质宠物。宠物岛的原奖励字段为 0，采集暂发现有可消耗的宠物精华 `1101`，这是可替换的本地兼容规则。
- `pveActionSnapshot` 的固定字段为 `currencies`、`inventory`、`cards`、`deck`、`enhancements`、`growth.cityLastTaxDay`、`growth.reputationClaims`、`growth.repeatClaims`、`growth.pets`、`growth.wheelDay`、`growth.wheelCount`、`guildContribution` 和 `friendshipCount`。调用方必须在操作前取快照，操作成功后把同一快照交给 `onPveAction`。钩子只在资产、卡组、宠物经验、领取键、公会贡献或好友关系出现匹配变化时计数。
- 跨模块计数包括 `pvpMatches/pvpWins`、`cardSynthesisByQuality`、`dungeonWins`、`packs`、`taxClaims`、`explorations`、`dailyRandom`、`donations`、`equipmentCraftByQuality`、`cardDismantleByQuality`、`cardFuseByQuality`、`energyPurchases`、`forcedTaxes`、`cityAttacks/cityAttackWins`、`athleticsMatches/athleticsWins`、`petFeeds`、`petSyntheses/petSynthesisByQuality`、`petIslandCollections`、`loopQuests` 和 `helperDungeonWinsByLevel`。限定模式的计数使用 `模式:副本:同公会` 等稳定组合键。
- `onPveBattleSettled` 会为普通剧情/合作战斗写入 PVE 场次、胜场、触发器、副本难度、真实击杀和实际回合数；`record.killedMonsters[actorId]` 缺失时不会推断怪物击杀。竞技结算要求所有参与角色都存在、`ai:false`、账号各不相同，并且恰好分成两支人数相等的队伍；`ranked/clan-war/tournament` 仍只接受双账号对局，`pvp` 接受 1v1、2v2、4v4。重复结算不会重复累加。
- 源 PVP `mode` 按位匹配真实队伍人数：1v1 对应 bit 1，2v2 对应 bit 2，4v4 对应 bit 4；因此 mode 3 可接受 1v1/2v2，mode 12 可接受 4v4，mode 15 可接受三种规模。一次对局只推进包含其实际 bit 的目标，1v1 不再推进 2v2/4v4。`sameguild=1` 只在当前角色确有同队队友且所有同队队友都属于当前角色公会时计数；同公会对手不冒充同队公会成员。
- 奖励支持银币、金币、水晶、经验、卡牌和固定道具，领取键为源 task id，重复领取会被拒绝。

### 任务上限与本地可达性

以下只比较启用任务会读取的上限和本地实际可推进能力。`Task.xml` 的 1182 个启用 group 引用均能解析到任务，未发现缺失引用。

| 领域 | 源任务或源表要求 | 本地可达上限 | 结论 |
| --- | --- | --- | --- |
| 城建（target 11） | 类型 1–5 分别为城堡、码头、炼金、铁匠、防御，启用任务最高要求 20 级 | 五类建筑都会为旧存档惰性补齐，均可从 1 级真实升级并计时完成到 20 级 | 已消除永久阻塞；target 类型与建筑键一一对应 |
| 宠物（target 36） | 启用任务最高要求宠物 10 级 | 宠物喂养上限 50 级 | 可达 |
| 角色等级与任务条件 | `ActorLevelInfo.xml` 原始行覆盖 Level 0–94；启用任务和求婚条件需要角色达到 100 级 | 内容层把可升级上限扩展到 100，并根据最后一条源记录外推缺失等级的升级经验与属性 | 可达；95–100 为明确的本地兼容扩展，不宣称来自原表 |
| 通天塔（target 25） | 启用任务最高要求普通塔 100 层；`TownLayouts.xml` 另含地狱塔至 525 层的任务相关范围 | 普通塔支持 1–100，地狱塔配置支持 501–535 | 可达 |
| 声望（target 26） | target 只要求完成一次声望领取；`Reputation.xml` 与 `ReputationShop.xml` 的配置等级最高均为 50 | 声望累计不设人为封顶，真实领取记录推进 target；奖励与商店均读取源表至 50 级 | 可达 |
| 装备强化（target 6） | 启用任务最高要求强化 20；`Qianghua.xml` 覆盖强化等级 0–20 | 强化操作上限 20，任务直接读取角色装备的实际最高强化等级 | 可达 |

## 状态与时间边界

- 世界共享状态位于 `world.pve`；个人楼层、场次贡献、禁地积分和源任务领取状态位于 `actor.pve`。
- 旧存档按访问时惰性补齐字段，不要求离线迁移。
- 世界 Boss 和禁地按 UTC+8 的自然日隔离。`tickPve` 只在状态确实改变时返回 `true`，供外层决定是否提交计划任务事务。
- 视图中的禁用状态只表达当前权威时间和资源条件，不能代替服务端操作时的再次校验。

## 定向验证

`backend/game/pve-systems.test.mjs` 使用实际导入表验证：动作与完整视图契约、1236 条层级任务无截断、塔怪物/地狱编号映射/费用/结算/重置、Boss 日程/阶段/真实零伤害/共享生命/贡献/等级/佣兵上限、禁地日程/积分/排行/兑换/真实发奖和防重、限时远征、VIP 精力与强征限制、宠物岛战斗与延时采集、宠物合成、跨模块差量钩子、2/4/8 个独立账号的真实竞技规模与位掩码、公会同队条件、非法重复账号和不平衡队伍拒绝、双方盟约与婚礼邮件、账号本地确认、精英包资产差量、十次真实本地金币补给到 3907 领取、卡组重排到真实 PvP 开局再领取 3904、所有 group 引用任务均无 `supported:false`，以及计划任务关闭的幂等性。
