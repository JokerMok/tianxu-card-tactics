# 图鉴、竞技赛与原版称号恢复决策

## 实现边界

本模块恢复原配置中已经存在、但此前服务没有可执行闭环的三部分：图鉴奖励、开包构筑竞技赛、原版称号战斗能力。竞技赛模块只负责角色状态、构筑校验和结算；真实 HTTP 幂等事务、双方房间、BattleKernel 对局和持久化仍由根服务接入。

公开接口如下：

- `competitionActions`
- `operateCompetition(ctx, action, payload)`
- `competitionView(ctx)`
- `tournamentDeck(ctx)`
- `onCompetitionSettled(ctx, record, won)`

支持的操作为 `tournament.register`、`tournament.deck.save`、`tournament.claim`、`collection.claim`。

## 图鉴奖励

`CardManualIndex.xml` 共 178 行，其中 18 个数值行配置了 `奖励ID`。`CardManualItem.xml` 的 `所属ID` 是子分类，例如 `1010101` 属于奖励父项 `1010100`，因此按 `floor(所属ID / 100) * 100` 归入父项。

图鉴只接纳 `main:embeddata/scp/card.xml` 中存在的卡牌。配置了展示时间的条目在服务器时间达到该时间后出现。角色永久卡库中数量大于零即视为已收集；完成百分比达到父项的 `百分比` 后可领取一次。

原始包缺少 `奖励ID` 对应的独立奖励生成表，但父项同时提供 `卡牌ID1..4`。本地兼容规则将这些有效主表卡牌各发放一张，例如 Human 父项 `1010100` 达到 75% 后发放 63、94、124、35。若某父项没有任何有效奖励卡，才使用明确的保底规则：银币 `max(50, 奖励ID × 25)`，避免出现空领奖。

`competitionView().collection.groups` 返回全部可领奖父项及其全部有效卡牌，没有服务端截断；客户端自行分页。当前主表映射结果为 18 个奖励组、1475 个有效图鉴卡条目。

## 普通竞技赛

普通竞技赛采用三胜或三负结束的本地规则：

- 报名费固定为 120 银币，不使用现金或外部支付。
- 报名后从当前职业可使用、且能由恢复后的卡牌/怪物/技能配置解析的主表卡牌中无放回抽取 30 张，分为三包，每包 10 张。
- 自动使用前 10 张组成可立即参赛的卡组。首场比赛前可通过 `tournament.deck.save` 从已开出的 30 张中重新选择恰好 10 张。
- `tournamentDeck(ctx)` 在根服务开始竞技赛房间时重新校验卡组只包含本次开包池中的卡牌。
- 开包池、当前构筑和统计只保存在 `actor.competition.tournament`，不会写入 `actor.cards` 永久卡库。
- `competitionView()` 返回全部 30 张卡、三包内容、品质/类型统计，以及 `card-multiselect` 选项，界面无需让玩家手填卡牌 ID。

`onCompetitionSettled` 只接受 `record.mode === 'tournament'` 的两名真人记录，并按角色写入 `record.competitionSettledActors` 防止同一场重复结算。AI 对手不能推进竞技赛。根服务应为每名真人参赛者各调用一次。

结束时按胜场查 `AthleticsPrize.xml`。普通赛只会使用 `WinTime` 0 至 3 的主奖励行；`BaoID`、`BaoNum` 直接发放真实物品，本包中对应 `main:item:3001` League Pack。`OnlinePrizeTableGroup`、`FanPaiNum` 和 `prize` 原样保存在奖励记录中，便于展示和后续恢复翻牌服务。当前资源缺少这些翻牌组的奖励表，因此不伪造翻牌内容；League Pack 本身可通过现有背包逻辑开出六张卡，确保三胜和三负结算都不是空奖励。

领取后会写入完整历史记录；领取完成后才能报名下一轮。

## 原版称号

`Appell.xml` 有 13 个有效称号。养成视图现在完整列出这些称号，并沿用现有 `item-title:<ID>` 所有权与到期时间。未持有或已过期的称号显示但不可装备。

装备原版称号后，`combatBonuses` 从对应 Appell 行读取 `Ability1..4`，把所有非零能力作为战斗 effect 注入 BattleKernel。称号 2 “Ascension's God” 会实际提供 50101、50501、50301、50401；过期称号不提供效果。已有三个本地声望称号继续保留。

## 定向验证

执行：

```text
node --test backend/game/competition-systems.test.mjs backend/game/growth-systems.test.mjs
```

验证覆盖：完整图鉴列表、父子映射、75% 阈值、非空且只领一次的奖励；三包开卡、十张自动构筑、可视化选项、非永久卡库；真人三胜与三负、重复结算保护、AI 拒绝、`AthleticsPrize` 奖励领取；13 个 Appell 称号及四项能力进入战斗效果。现有增长系统定向回归同时运行。
