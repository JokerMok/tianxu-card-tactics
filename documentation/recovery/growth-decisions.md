# 成长、经济与活动服务端实现决策

日期：2026-10-20
实现：`backend/game/growth-systems.mjs`

## 证据边界

本模块实现的是本地权威游戏规则，不冒充 Kings Call 原服务端算法。静态客户端证据确认了背包、装备、铁匠、卡牌加工、商城、仓库、宠物/坐骑、声望/称号、城市、活动、战令、回归任务、轮盘/许愿和召唤世界的入口与服务端依赖。明确可读取的 `main` 配置直接用于装备限制、强化概率、装备进阶关系、符文配方、卡牌合成率、熔炼材料、宠物目录/经验、活跃奖励、许愿奖池和战令奖励。`media` 配置不会参与计算。

旧客户端只提供请求、回包和页面链，未恢复商城定价、原服掉率、部分炼制成功率、支付发货、活动开服周期及完整城建公式。缺失部分采用下方可审查的本地规则。外部充值、Steam 订单、官方接口和网络调用全部排除。

## 模块契约

- `growthActions: string[]`：全部可路由动作。
- `operateGrowth(ctx, action, payload)`：同步执行；参数非法、资源不足、重复领取、未开放或时间未到时抛出 `Error`。调用方必须在同一 SQLite 世界事务中克隆/回滚并按角色与 `requestId` 去重。
- `growthView(ctx)`：返回可 JSON 序列化的 `{version,generatedAt,summary,pagination,sections}`。每个 `sections[].items[]` 至少包含 `{label,detail,action,payload}`，可选 `disabled` 和 `fields`。模块返回完整背包、卡牌、装备、配方及宠物数据，分页由根路由统一处理，不在此处截断。
- `combatBonuses(ctx)`：返回 `{hp,attack,effects?,cards?}`，供根战斗服务叠加到职业/等级基础战斗值。这里的 `hp/attack` 全部是额外值，不能替代基础值；`effects/cards` 是配置中的装备/宠物效果与装备技能卡。
- `tickGrowth(world,tables,now)`：完成已到期的建筑升级并写入经济日志；有变化返回 `true`。

## 动作与 payload

| 动作 | payload | 结果与主要校验 |
| --- | --- | --- |
| `test.grant` | `{silver?,gold?,crystal?,itemId?,count?}` | 每自然日一次；上限分别为 500/10/100/3，用于本地测试，不接支付。 |
| `test.unlockBattlePass` | `{track:'premium'|'ultimate'}` | 本地测试或管理入口；每季每轨道只能解锁一次，不连接支付。 |
| `inventory.use` | `{itemId,count?,profession?,name?,gender?,choice?,choices?}` | 按 `medicament.xml` 的作用 ID 处理转职、数值、礼包、卡包、随机包、多次包、改名、性别、变身、物品合成、称号、战令和自选宝箱。`choices` 可为数组或逗号分隔文本。 |
| `inventory.sell` | `{itemId,count?}` | 按配置卖价发银币；锁定物品不可出售。 |
| `equipment.equip` | `{itemId,slot?}` | 校验配置中的职业、等级和槽位，原槽装备回背包。 |
| `equipment.unequip` | `{slot}` | 装备回背包。 |
| `equipment.enhance` | `{itemId}` | 消耗对应阶段强化石和银币，使用 `QiangHua.xml` 概率及 `randomInt`。 |
| `equipment.craft` | `{itemId}` | 根据 `Equipment.xml` 的“合成装备ID”反查前置，消耗 3 件与银币。 |
| `equipment.runeCraft` | `{recipeId}` | 使用 `PeiFang.xml` 的材料、晶石和产物。 |
| `equipment.refine` | `{itemId}` | 本地 10 阶规则，逐阶提高银币消耗。 |
| `magic.dismantle` | `{cardId,count?}` | 按卡牌品质返还晶石。 |
| `magic.synthesize` | `{cardId}` | 消耗 3 张与银币，使用卡表 `NextCardID/heChengRate`。 |
| `magic.refine` | `{cardId}` | 完整校验并消耗 `ronglianpeifang.xml` 四组炼制材料。 |
| `magic.enchant` | `{cardId,materialCardId}` | 按 `cardronghe.xml` 校验同品质种族组合、炼金房等级和催化材料，按 `cardronghegailv.xml` 由服务端随机产出融合卡。 |
| `magic.point` | `{cardId,materialCards?:[{cardId,count}]}` | 按 `DianHua.xml` 的品质、唯一性、种族、材料、银币和炼金房门槛将卡牌升到目标品质；材料卡可抵扣银币。 |
| `magic.fuse` | `{cardId}` | `magic.refine` 的兼容动作名，供旧客户调用。 |
| `magic.jar` | `{count?}` | 每次 25 晶石，服务器随机抽取至橙色品质卡；1–10 次。 |
| `shop.buy` | `{offerId}` | 当前普通补给：`supply:gem`、`supply:pet-food`。 |
| `shop.openPack` | `{offerId:'pack:basic'}` | 5 金币抽 3 张，服务器随机。 |
| `shop.openTen` | `{}` | 45 金币抽 10 张。 |
| `shop.buyLimited` | `{offerId:'limited:crystal'}` | 每日一次，8 金币换 80 晶石。 |
| `shop.exchange` | `{offerId:'exchange:crystal'}` | 50 晶石换 500 银币。 |
| `shop.reputation.buy` | `{cardId}` | 从 `ReputationShop.xml` 查找卡牌、声望类型、声望等级门槛和银币价格；客户端提交的价格或声望类型不参与结算。 |
| `shop.skill.buy` | `{cardId}` | 购买当前职业的白色技能卡；每张固定 150 银币，最多持有 3 张。 |
| `warehouse.lock` | `{itemId,locked?}` | 锁定/解锁背包或仓库物品。 |
| `warehouse.move` | `{itemId,count?,to:'warehouse'|'inventory'}` | 原子移动；仓库最多 100 种物品。 |
| `pet.adopt` | `{petId}` | 3 级开放，使用宠物配置并按品质收银币。 |
| `pet.feed` | `{petId,itemId?,count?}` | 默认消耗配置中的基础宠物精华 `main:item:1101`；经验读取药品表“宠物精华”数值。 |
| `pet.upgrade` | `{petId}` | 使用 `PetExp.xml` 对应品质与等级需求。 |
| `pet.learnSkill` | `{petId,skillId}` | 只能学习宠物配置列出的技能；最多 4 个，消耗金币。 |
| `mount.adopt` | `{itemId}` | 仅接受装备表小类 12，消耗对应坐骑装备。 |
| `mount.upgrade` | `{mountId}` | 本地 20 级银币成长规则。 |
| `mount.equip` | `{mountId}` | 设为当前坐骑。 |
| `reputation.claim` | `{type,level}` | 使用声望表门槛；奖励是本地银币/里程碑金币规则。 |
| `title.equip` | `{titleId}` | `novice/trusted/renowned`，按总声望 0/2500/10000 解锁。 |
| `profile.update` | `{avatarAssetId?,name?}` | 未发现可独立使用的源头像配置，头像明确采用“已持有卡牌的真实导入原画”作为本地适配；服务端只接受当前白名单中的资源 ID。改名校验字符并消耗 5 金币。 |
| `city.upgrade` | `{buildingId}` | `castle/dock/alchemy/smithy/defense` 五种建筑均最高 20 级；银币成本 `500×目标等级`，耗时 `目标等级` 小时。 |
| `city.tax` | `{}` | 每日一次，银币为城堡等级×300；升级中不可征税。 |
| `activity.loginClaim` | `{}` | 每日登录，连续周期最多 7 天，第 7 天另发金币。 |
| `activity.checkin` | `{}` | 每日签到，发宠物口粮；每 7 次加倍。 |
| `activity.chest` | `{index}` | 按 `livelyprize.xml` 门槛和职业奖励领取；使用当日养成活跃度。 |
| `activity.wheel` | `{}` | 每日 3 次，每次 100 银币，从本地奖池服务器随机。 |
| `activity.wish` | `{group:1|2}` | 每日一次，使用 `MakeWish.xml` 奖池；分别消耗 2/5 金币。 |
| `activity.weeklyGrant` | `{}` | 累计 7 次养成操作后每周领取一次本地补给，替代周充值入口。 |
| `activity.rewardBonus` | `{}` | 累计 20 次养成操作后每周领取一次额外奖励。 |
| `quest.returnClaim` | `{}` | 最后一次明确角色活动后离线至少 7 天可领取一次；旧数据首次判定使用 `lastLogin` 兜底，已登录页面心跳按分钟精度计为活跃，定时 tick 不计为角色活动。 |
| `quest.repeatClaim` | `{questId}` | `growth-actions/card-craft/pet-care`；只读取本模块当日计数，不覆盖 PVE 任务进度。 |
| `battlePass.claim` | `{level,track?:'free'|'premium'|'ultimate'}` | 每 5 次累计养成操作或 500 战令经验升一级，28 天一季。免费/进阶轨道分别读取 `regular_Id/advanced_Id`，终极轨道使用明示的本地加成奖励。 |
| `summon.world` | `{count:1..10}` | 每次 30 晶石，服务器随机抽取至红色品质卡。 |

ID 使用规范化命名空间：物品 `main:item:<数字>`、卡牌 `main:card:<数字>`。配置查找只接受传入 `tables` 中的小写逻辑路径，例如 `embeddata/scp/equipment.xml`。

## 本地规则与时间规则

历史 `timeActivity.xml` 的绝对日期已经失效，不能把所有活动永久锁死。实现改用服务器 epoch 派生的每日周期、28 天战令季和一次性回归资格。每日状态在第一次调用时按 UTC 日键滚动，随机结果只取 `ctx.randomInt(max)`。明确角色活动的心跳按分钟精度持久化：首次触达、间隔已达 60 秒或回归资格发生变化时才写入。

商城是纯游戏内货币商店，价格集中在模块 `LOCAL.shop`。充值返利、首充、周充和现金购买不连接支付：周充与额外奖励改为有养成门槛、每周一次的本地领取，战令改为道具或每季一次的测试解锁。每日测试补给仍有资源硬上限。

`ReputationShop.xml` 是可直接采用的原始商店目录。反编译的 `ReputationMediator.onSelectShop` 用 `DataCenter.TYPEID_CREDIT_LEVEL` 与每组 `level@value` 比较，因此 7、14、21 等是对应类型的**声望等级**，不是玩家等级；`ReputationShopBuyWndMediator` 用 `Hero.sliver / unitCost` 计算可购买数量，证明 `price` 使用银币。当前服务端按 `Reputation.xml` 的累计声望阈值计算声望等级，再按源卡牌和源价格发货。

职业技能商店属于缺失服务器商城目录后的本地常驻补建，标记为 `LOCAL` 规则，不声称 150 银币是原服价格。目录只收录 `Card.xml` 中 `Type=2、Quality=0` 且其 `SkillID` 在 `Skill.xml` 的“使用职业”与当前角色职业一致的有效卡；用于让职业技能卡除随机卡包外有稳定获取途径。卡组同名卡限制为 3，因此商店持有量也限制为 3。

恢复目录的配置逻辑路径与资产路径中未发现可独立使用的头像表或头像资源目录，因此不把任意字符串冒充头像资源。`growthView.profile` 返回当前安全的 `avatarAssetId` 以及按持有卡牌生成的 `{label,value,assetId,cardId,path}` 选项；每个选项都对应目录中实际存在的导入图片。旧存档的任意 `profile.avatar` 字符串原样保留，但若不在当前白名单中，展示值回退到第一张仍持有且有真实原画的卡牌。新更新只写入已验证的 `profile.avatarAssetId`。

每次货币或资产扣除/发放都会向 `actor.economicLog` 写入 `{at,kind,asset,amount,reason}`，本模块不截断日志；根服务完整归档已持久化后的后缀。建筑成熟也写日志。调用方的原子事务保证中途失败不会保留日志或局部扣款。

装备后物品从 `inventory` 移到 `equipment`，卸下后原路返回，因此社交交易不会重复看到已装备物品。配置为“获取绑定”的物品会进入根服务约定的 `actor.boundItems`；仓库锁会同时写 `actor.lockedItems` 与成长状态，解锁或资产耗尽时同步清理。仓库移动保持绑定属性，锁定物品不可出售或移动。社交转移还应由根服务统一拒绝 `boundItems`、`lockedItems` 和当前装备中的物品。

战斗加成按当前装备槽计算：武器槽增加攻击，其余槽增加生命，强化与精炼提高额外值；装备配置中的效果和技能卡原样返回。宠物自动选择等级最高的一只作为战斗伙伴，读取 `PetUpAttr.xml` 与 `PetSkill.xml`；当前坐骑按等级追加生命和攻击。这些是本地兼容规则，基础职业/等级属性仍由根战斗服务计算。

## 已知限制

- 普通商城与职业技能商店的完整原服目录、卡包和随机道具包的原服奖池、轮盘奖池、城建前置链、坐骑本体配置和称号原表未从静态客户端中完整恢复，因此对应项使用上述本地规则。声望商店目录、门槛和银币价格直接使用已恢复的 `ReputationShop.xml`；卡牌融合与点化也直接使用已恢复的配置表。
- `inventory.use` 支持所有有直接使用语义的作用 ID；作用 ID 0 的被动自动合成材料以及没有作用配置的强化石仍不允许直接使用。原卡包组和随机道具包组未恢复，分别使用 6 张服务端随机卡和本地可用道具池。
- 战令进度只来自本模块的真实养成操作计数；PVE、PVP 等其他计数应由根服务在其权威结算中增加，不能由客户端直接提交任意进度。
- `growthView` 是通用动态菜单与表单元数据，不包含客户端分页游标；表单字段使用 `{key,label,type,value?}`，根 Cocos UI 负责分页并把输入字段合并回 payload。`materialCards` 是高级可选参数，通用菜单默认不填充折扣卡。
