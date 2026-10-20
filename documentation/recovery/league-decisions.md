# 天梯赛季与公会城战恢复决策

## 实现边界

本模块提供独立的联赛状态机，公开接口为 `leagueActions`、`operateLeague(ctx, action, payload)`、`leagueView(ctx)`、`tickLeague(world, tables, now)`、`validateLeagueRoom(ctx, opponent)` 与 `onLeagueSettled(ctx, record, won)`。房间创建、BattleKernel 对局、HTTP 请求幂等和根事务仍由 `GameService` 接入。

模块没有“点击即获胜”操作。天梯与城战进度只能由包含双方角色、双方战斗玩家和实际胜方的已结算真人记录推进。重复传入同一记录时，天梯按角色防重，城战按整场防重；AI、同账号天梯、同公会城战、未报名公会及无效领地均被拒绝。

## 每周天梯

赛季采用真实的北京时间自然周：周一 00:00 开始，下周一 00:00 结束。`tickLeague` 或任一联赛入口首次发现跨周时冻结旧周排名；按赛季结束时角色积分、赛季胜场、角色 ID 依次排序。空周不制造历史或奖励。

奖励来自 `RankingReward.xml` 的当前服 `server[1]`、普通 PVP `pvp[1]`：类型 1/2/3/4/5 分别解释为银币、金币、卡牌、物品、荣誉，与原客户端 `RankConstants` 一致。当前配置奖励前 100 名；奖励先写入角色待领取队列，再由 `league.reward.claim` 原子领取。奖励 ID 同时包含赛季和角色，重复定时结算或重复领奖都不会再次发放。

每次结算把完整名次、积分和赛季胜负写入世界历史及角色历史。新赛季采用显式软重置：`1000 + round((旧积分 - 1000) × 0.5)`，保留一半相对 1000 分的偏差，不清零生涯胜负。

## 公会城战

原包没有独立的地理领地配置。本实现不虚构城市，直接从 `clanhuodong.xml` 中筛选标题同时包含 Guild 与 Battle 的原版公会战活动，使用 `main:clan-activity:<原ID>` 作为可争夺战场 ID；视图保留原 `_path` 作为来源证据。当前 main 配置能恢复双龙战与 Guild battle 两个目标。

会长通过 `clanwar.register` 为本周和指定目标报名。开房、加入或开战前应通过 `validateLeagueRoom` 校验双方均为该周已报名公会的真实成员，且分属不同公会。根服务需要把房间的 `territoryId` 原样写入战斗记录；`onLeagueSettled` 只读取记录中的该字段，不根据按钮参数补造战果。

每场有效记录按胜方 3 分、负方 1 分累计比赛、胜负、参战角色和公会积分。当前控制方按积分、胜场、公会 ID 确定；周结算后控制方冻结到下一次有效争夺结果。

周奖励来自 `clanbattleprize.xml`：公会财富在结算时直接进入对应公会资金；真实参战角色获得“参赛队伍”银币、水晶、贡献和物品待领取奖励；没有参战但本周公会贡献达到源配置 `公会成员领奖条件` 的成员获得“公会成员”奖励。这样保留 700 贡献门槛，同时确保实际参战者不会因本地缺少原服报名贡献流水而拿到空奖励。角色通过 `clanwar.reward.claim` 领取，赛季、目标和角色共同组成防重 ID。

## 根服务接入要求

- 把 `leagueActions` 加入操作路由和战斗期间锁定集合，并把 `leagueView(ctx).sections` 合并到统一菜单。
- 创建城战房间时要求并保存 `payload.territoryId`；加入与开始前用带 `mode`、`territoryId` 或 `room` 的上下文调用 `validateLeagueRoom`。
- 创建城战战斗记录时复制 `room.territoryId` 到 `record.territoryId`。
- 完成真人天梯或城战结算后，为每名角色调用 `onLeagueSettled`。城战函数自身按整场防重，第二次调用为无操作。
- 在权威定时事务中调用 `tickLeague(world, tables, now)`。

## 定向验证

执行 `node --test backend/game/league-systems.test.mjs`。覆盖北京时间周边界、天梯重复结算与软重置、源奖励及一次领取；会长权限、来源领地、双方报名、不同公会、同领地争夺与控制权；真人记录累计、城战排名奖励、成员贡献门槛以及 AI/无效记录拒绝。
