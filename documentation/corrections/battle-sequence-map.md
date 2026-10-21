# 战斗表现时序映射

核对日期：2026-10-21。以下是官方本地客户端反编译源码的静态时序证据，不是原游戏运行录屏。

## 原版时序依据

| 阶段 | 原版静态证据 | 对当前适配的约束 |
|---|---|---|
| 服务消息依次分派 | `MainActionCommand.as:924-976` 读取动作类型，并分别调用 move、attack、die、damage rehearsal、status、to-back | 保留服务端事件顺序；新快照不能先覆盖最终位置、HP 或实体集合 |
| 移动 | `ThingTableProxy.as:136-148` 把目标格交给 `CrtCmdMove`；`CreatureItem.as:363-400` 进入 walk，移动结束后才派发 `MOVEEND`（同文件 `330-350`） | move step 从 `moveFrom` 动画到 `moveTo`，完成回调后提交可见格位 |
| 攻击开始 | `ThingTableProxy.as:151-190` 创建攻击参数和魔法对象后调用 `CrtCmdAttack`；`CreatureItem.as:407-499` 配置攻击帧、结束帧和下一状态 | attack 是独立 step，不能用固定时间直接跳到下一事件 |
| 真实命中点 | `CreatureAttackState.as:38-51` 到配置 `_attakFrame` 才启动 magic，到 `_endAttackFrame` 才退出攻击态；缺失攻击帧配置时 `CreatureItem.as:430-436` 使用第 3 帧与动画最大帧 | 由动画 `onAttack` 调 `cue(token, 'impact')`，此时才提交伤害/治疗 HP；攻击结束回调再 `complete(token)` |
| 扣血与受击 | `BattleProxy.as:118-145` 把 damage rehearsal 交给 `CrtCmdBeHit`；`CreatureItem.as:539-556` 将浮字挂到对应攻击 magic，不能关联时才立即播放 | attack step 吸收其后连续 damage/heal/effect/status；impact cue 同步浮字、特效、HP 与受击反馈 |
| 死亡 | `ThingTableProxy.as:237-254` 先调用 `Creature.Die()`；`CreatureItem.as:587-600` 若仍在 attack/behit，先把下一状态设为 die，否则立即进入 die | 致死 impact 后实体仍留在 visible state；death step 完成前不得释放节点 |
| 死亡结束 | `CreatureDieState.as:20-38` 进入 die 后启动 600ms alpha effect，并在内部计时约 2 秒后 destroy | 有原生 die 时间线时等真实完成；缺失 death 帧时不得播放 stand，使用容器 600ms 淡出作为源码有据的降级，完成后才 `complete` 并释放 |

## 新状态边界

- `BattleState` 仍是服务器权威状态；`BattlePresentation.visibleState` 是当前帧允许显示的状态。
- `sync(snapshot)` 只接收比已见 `seq` 新的事件并排队。重复 poll 不重复播放；队列未完成时到达的新快照追加到同一序列；不按本地操作者过滤，因此 PVP 其他连接产生的动作也会播放。
- PVE 创建时服务端同时保存 `createBattle` 的原始 `entryState` 和经过 `advanceAI` 后的当前权威 `state`，两者都通过 `publicBattle` 按当前玩家投影。客户端只有在本次 `run` 新建战斗，或轮询首次发现新的 battle ID 时，才以 `entryState` 建立 baseline，再把当前 `state` 中新增事件排队，因此 AI 随机先手不会在开场画面前预先扣血。启动、刷新、重新登录和手动恢复已有战斗仍直接以当前 `state` 建立 baseline，不重播历史；没有 `entryState` 的旧存档和 PVP 战斗也沿用该兼容路径。
- `nextStep()`/`update()` 返回当前 step，直到适配层调用 `complete(token)`；带 HP 变化的 step 必须先收到 `cue(token, 'impact')`，因此不会因轮询或固定 150ms 计时越过命中帧。
- death step 发出时 HP 可以已为 0，但 unit 仍存在；只有 death 动画 Promise/回调结束后 `complete` 才移除。所有 step 清空并与最新权威快照对齐后，`settledReady` 才能为 true。
- `replayTrace()` 保存 baseline、已规划 step（含 before/after、moveFrom/moveTo、HP 前后值和原事件）以及 cue/complete 轨迹，供确定性复盘；事件里的 unit view 只含公开战场单位数据，不含牌库或手牌。

2026-10-21 实机检查增量：拖牌部署、自动连续回合和结算返回已运行。首轮实际录像发现固定 +119 名称/+100 血量导致顶排文字越界，已按 CreatureItem.updateBloodAttackTextPos 的逻辑位置下方 +25、updateNamePos 的原锚点定位修改，顶排名称增加视口内保护。模型锚点不是脚底标记，不能把格子中心与透明位图脚底等同；其公共 renderer、未缩放 anchor 和西向镜像按 AS3 顺序修正。修正后的画面需以最新实际构建录像为准。
