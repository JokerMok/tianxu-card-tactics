# 成长窗口原版映射

实现入口：`cocos-client/assets/scripts/game/GrowthWindows.ts` 和 `AdvancedGrowthWindows.ts`。坐标使用 1200×600 设计空间；主窗沿用 `PackageWnd` / `SmithyWnd` 的源位置 `(240,40)` 和 `709×443` 尺寸。

| 运行区域 | 原版依据 | 当前恢复图片 |
| --- | --- | --- |
| 主窗口和通用内框 | `PackageWnd.bg=ckxiao`、`NTabbedPane.bg=xiaochuangkoubj` | `ckxiao`、`xiaochuangkoubj`（明确选 `gonggongchuangkou.swf#144`） |
| 背包 | `PackagePane` 左侧 `EquipPane`、右侧 `SmallPackagePane`；物品栏每页 6×6、36 格 | `zbbj_1`、`bqbb/bqbb_l` |
| 角色资料 | `EquipPane.ITEM_X/ITEM_Y` 的 14 个固定装备位及角色动画区 | `renwuziliao`、`bqzl/bqzl_l` |
| 坐骑 | `PackageWnd` 第三页签的坐骑语义 | `zbbj_2_zq`、`bqzq/bqzq_l` |
| 铁匠页签 | `SmithyWnd` 的强化、合成、锻造竖向页签 | `bqqh/bqqh_l`、`bqhc/bqhc_l`、`bqdz/bqdz_l`、`tiejiangpu` |
| 强化面板 | `QianghuaPane` 左区为 324×303 底板，装备槽 `(128,50)`、三个材料槽 `(55/142/227,139)`、箭头 `(73,117)`、概率区 `(7,239)`、强化按钮 `(120,339)`；`QianghuaMain` 右区为六列装备包 | `qhzbcl` 按 324×303 面板范围落位，`qhzb_3`、`qianghuajiantou`、`tjpchenggonglv`、`qh` 保持源坐标；右侧 `qhzbcl_2` 使用 6×4 装备格分页选择 |
| 宠物 | FairyGUI `Pet/PetWnd` 及其 `cTab` 分页；`PetWnd.as` 进入普通页时显式设置 `petEat=0` 并隐藏 `petEatGroup`；`bagList` 为 5×5、60×60 步进，`petShopList` 为 2×2、269×134 商品格 | 直接 mount 原组件；普通页只显示已拥有宠物，无宠物时保留空状态和前往商店入口；商店使用原表 `Pet.xml` 对应的 `pet{id}.jpg` 图标，按原商品格绑定 `pet.*` / `mount.*` |
| 魔法罐 | FairyGUI `MagicJar/MagicJarWnd` | 直接 mount 原组件，单抽/十抽绑定 `magic.jar` |
| 战令 | FairyGUI `PassPort/PassPortWnd` 及 `c1` 奖励/任务分页；奖励列为 96×332，任务单元为 994×136 | 直接 mount 原组件；奖励按等级列和免费/进阶/终极轨道落位，任务、声望、称号按三条原任务单元分页 |
| 城池选择 | FairyGUI `Town/TownSelectModelWnd` | 直接 mount 原组件，绑定 `city.tax` / `city.upgrade` |
| 卡牌加工 | `MagicCardShopWnd` 位置 `(240,20)` 和五竖向页签；合成源卡 `(41,97)`、结果卡 `(226,88)`、分解卡 `(127,64)`、执行按钮 `(127,398)`；炼制区为横向 `134×398` 配方列 | 使用 `kphcbj_1_2`、`kphcbj_1_3`、`kphcbj_2`、`kphcbj_3`；卡库按 3×3 原卡格分页，选中卡进入原操作区；炼制使用 `ronglianbeijing_1/2` 配方列和 `ronglian` 按钮 |
| 商店/声望商店 | `SuperShopWnd` 的 272×144 商品单元与双列容器；底部兑换券数量、提示和刷新按钮由运行数据覆盖；`ReputationWnd` 的 `swshangchengkuang` 155×178 商品格 | 超级商店按 2×2 商品卡分页，价格货币显示为银币、金币或晶石；底部显示当前真实货币余额，因现服务没有刷新券与刷新规则而明确显示“刷新尚未开放”；声望和职业技能商店按 3 个原商品格分页 |
| 活动 | `ActivtiesWnd` 的左侧活动选择栏和右侧 470×379 详情区 | `yjdi`、`huodongbeijing_1`；签到、宝箱、轮盘、许愿和周奖励逐项选择后在详情区执行 |
| 通天塔 | `TownWnd` / `TownHellWnd` 的 731×343 场景区、卡位、刷新/重置和 176×74 挑战区 | `tttbeijing`、`tttbeijing_2.jpg`、`tttbeijing_6`、`kaishitiaozhan`；普通/地狱动作分别绑定 |
| 禁地 | `ForbiddenViewContent` 的三列 `ExchangeItem`（184×322）和底部功能按钮带 | `jinduanzhidibj`、`duihuandi`；挑战、三列积分兑换和赛季奖励保持可用 |
| 世界 Boss | `WorldBossZoneWnd` 的左侧列表、右侧 Boss/三格奖励区和底部操作区 | `shijiebossdi_1`；挑战、三名佣兵和奖励领取分别落位 |
| 出征港口 | `HoldonPortWnd` 的 590×55 单列岛屿列表、左侧详情/计时/卡组区和 `(1085,380)` 出发/领取按钮 | `czgkbj`、`ajksch`、`ajmzeg`；岛屿选择保留 `hours` 字段并绑定出发或领取 |
| 排位赛季 | `RankingWnd` 的左侧赛季奖励区和 `(542,70)` 排行面板 | `paihangbangbeijing`、`jingjisaijingjichang`；显示真实天梯排名并绑定待领取赛季奖励 |
| 竞技赛 | `JingjisaiWnd` 的胜负旗、中央宝箱、卡组按钮、右侧说明和底部开赛按钮 | `jingjisaidi`、`jingjisaiqi_1`、`jingjisaixiangzi1_1`、`zbstp`；报名、卡组构筑、创建房间和领奖按当前阶段出现 |
| 召唤世界 | `SummonWorldWnd` 的左侧 `CollectPanel` 和右侧 `SearchWorld`；搜索区为 2×4 卡背、普通/高级搜索双按钮 | `zhaohuanshijiedi`、`fpbm.png`、`aj_putongsousuo`、`aj_gaojisousuo`、`aj_sousuoguize`；单次/十次直接绑定 `summon.world` |
| 护城要塞 | `CityWarWnd` 的要塞图、耐久区、修复/建造、好友/战报区、卡组和攻击区 | `kphcbj_1_2`、`huchengyaosaidi`、`wodeyaosai_1`、`ajhcysxiufu`、`ajhcysjianzao`、`ajhcysgongji`；建造绑定现有城防建筑升级，其余缺失规则在原格位明示 |

窗口直接消费 `state.growth.sections` 的 action、payload、fields 和 disabled 状态；背包、仓库、装备、强化、精炼、合成、符文及其它成长模块均保留入口。物品名称取 `state.assetNames`，物品栏和装备位优先使用 `state.assetIcons[itemId]`。该映射来自 `equipment.xml`、`medicament.xml`、`warrant.xml` 的源图片字段，由 `backend/game/player-ui.mjs` 输出；只有源表没有图标映射时才显示名称。角色区使用 `RecoveredAnimation.setActor`，调用方需在 Cocos `update(dt)` 转发时间，并在组件结束时调用 `destroy()`。

`bqbb`、`bqzl`、`bqzq` 分别保持背包、角色资料、坐骑语义。高级窗口不自行发明新经济规则：出征港口只绑定 `quest.explore.*`；护城要塞的建造使用已有 `city.upgrade(buildingId=defense)`，修复、保护和攻击只接受未来的 `cityDefense.*`。源界面存在但服务端快照没有对应动作时，界面在对应原格位显示明确的数据缺口说明。

超级商店的商品图标只使用现有源资源：强化石和宠物精华分别读取物品 100、1101 的 `qhs_1.jpg`、`cwdjinghua.jpg` 映射；卡包、晶石礼包和银币结果使用 `kahelibao.jpg`、`shuijinglibao.jpg`、`yinbidaoju.jpg`。原背景内嵌的“Currently has: 99”是静态示例，当前实现用真实银币、金币、晶石余额覆盖，不把它解释为刷新券库存。

## 当前差异

宠物、卡牌加工、三类商店、战令、活动、通天塔、禁地、世界 Boss、出征港口、排位赛季、竞技赛、召唤世界和护城要塞已经恢复各自的源格位、选择关系与操作区，正式路径不再使用全页通用纵向动作列表。召唤左侧收藏进度、素材与奖励数据尚未由服务端返回；护城要塞仍缺耐久、修复、保护、好友目标、战报、攻击券和攻击结算规则。

已有服务规则均保持可执行。远征时长在港口计时区直接增减，许愿在活动详情区直接选 7 日/30 日奖池，卡牌融合在加工区选主卡和素材卡，竞技赛卡组在比赛窗口直接勾选 10 张卡；这些主操作不再跳转通用表单。原客户端存在、当前服务没有对应规则的入口保留为明确的数据差异说明：通天塔内换牌和塔币商店，禁地刷新/排行/全服奖励，世界 Boss 房间列表，港口专用卡组，天梯本服/跨服切换，以及竞技赛放弃和独立排行。战令接口只返回未领取项目，因此已领取轨道无法从当前快照重建；魔法罐右侧也没有历史记录。原版动态装饰、倒计时和动画尚未逐帧恢复。

主线程接入时实例化 `GrowthWindows(ui, original, catalog, apiBase, callbacks)`，在成长页调用 `render(parent, state, section)`；`section='equipment'` 和 `section='smithy'` 均从铁匠入口打开，角色资料由窗口内 `bqzl` 页签进入。主要字段选择已经在各自源布局中直接完成，并通过 `callbacks.run` 提交；`callbacks.action` 只保留给真实文本输入和未映射调试回退，详情弹层复用 `callbacks.detail`。本文件只完成组件和源映射，真实 Cocos 点击、图片加载与服务回写由主线程统一验收。

2026-10-21 补充：角色等级、经验进度和生命值由服务端 `growth.characterStats` 显式提供，沿用 actorStats + 已有 combatBonuses 与公会生命加成，和开战使用相同规则。原界面的暴击、士兵格挡/攻击百分比尚无当前规则模型支持，显示“—”，不伪造数值。

2026-10-21 强化页校正：进入强化页时不自动沿用背包选择，只有从右侧装备格选中真实 `equipment.enhance` 条目后才向左侧装备槽绘制图标；没有匹配装备时清空选择。左右面板和底部强化按钮均收在 660×399 内容区内。

2026-10-21 宠物页校正：普通页固定隐藏吸收分组及其未替换的模板文本，且在 `cTab` 异步刷新后再次恢复该状态，避免两层面板重叠。普通列表不再混入全部待领养目录；待领养宠物仅在商店页出现，并使用已恢复的原始宠物图标。`Pet.xml` 共 31 条宠物记录，当前资源包有 30 张对应的 `pet{id}.jpg`；`pet1019.jpg` 未恢复，该条目保持无图，不用卡牌或碎片图替代。当前服务没有宠物转生规则，转生页只显示“尚未开放”，不暴露原组件的变量占位文本。

2026-10-21 实机补查：宠物页面明确区分空背包和待领养商店，原按钮在无可用动作时禁用。商品展示原本本地规则的领养价格（300 + 品质×200银币）与3级门槛，余额不足禁用；这只是操作投影，未改变既有扣费。
