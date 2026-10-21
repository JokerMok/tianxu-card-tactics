# 卡组编辑窗口源映射

核对日期：2026-10-21。以下映射来自本地原客户端 ActionScript 与已导入资源；这是静态还原依据，不代表已经取得原游戏运行录屏。

| 当前实现 | 原版静态依据 | 约束 |
|---|---|---|
| 922×540 主窗口、关闭按钮 | `CardEditWnd.as:25-45`：窗口位于 160,0，大小 922×540；关闭按钮位于 876,25，大小 36×35 | `CardDeckWindow` 在 1200×600 舞台的 Cocos 中心坐标为 `(21,30)`，使用导入的 `guanbi` 皮肤 |
| 左侧信息区 | `CardEditWnd.as:29-42` 将 `CardEditLeftInfoPane` 放在 `(0,18)`；`CardCount.as:22-43` 将当前/上限、最小张数、卡组战力和自动组牌按钮分别放在左栏 `(35,60)`、`(99,94)`、`(35,145)`、`(35,165)`；`CardEditLeftInfoPane.as:68-70` 的 `ajkptj` 位于左栏 `(6,462)`，大小 134×36 | 左区直接使用已带 `Current cards / Mini cards / Deck power` 文字的 `kpbjbeijing`，只在 AS3 对应坐标填入数值与按钮热区，避免叠加第二套标题。卡组上限来自 `actorlevelinfo.DeckCapacity`，战力按 `Deck.as` 的品质权重 `[100,120,150,180,210,250,300]` 计算 |
| 中央卡组与右侧卡库 | `CardManagerBook.as:51-99`：书页背景 `KaPaiBianJi`，内容区上 24、左 30、下 25；卡组区首选宽 342；`NewAllCardsPane.as:29-57,103-117` 使用 3 列并按每页 9 张分页 | 两侧都使用 3×3 槽位；右侧保留 40px 种族/职业竖向按钮栏。状态只在窗口实例内更新，重绘不丢草稿、页码与筛选 |
| 卡牌尺寸与内容 | `CardEditCurDeckPane.as:15-24`：槽位 100×143、3 列；`SmallCardPane.as:39-80`、`SmallCardTopPane.as`、`SmallAttackAndHPPane.as` 与 `CardBackgroundPane.as`：卡牌 85×116，原画内缩 3px，上层包含种族/技能边框、品质星、准备值、攻击和生命 | 实现使用 100×143 槽位和 85×116 卡面；原画按 79×110 内缩。卡框、准备底板、品质星及种族/职业标记优先使用 AS3 `UIHelper.getBitmapFromNewPlayer()` 对应的 `game/data/newplayer.swf` 变体；攻击/生命读取卡牌 `MonsterID` 对应怪物表，攻击为 0 的城墙按原逻辑隐藏攻击值 |
| 筛选 | `TypeBtns.as`：职业兵、普通兵种、技能三组原按钮；`ZhongzuBtns.as` / `zhiyeBtns.as` / `ZhiyeShibingBtns.as`：40px 右侧竖向栏 | 普通兵种与职业兵按怪物表 `Phyle` 分组，技能沿 `SkillID` 读取技能表 `使用职业`；类型与二级按钮均使用 `kapaibianji.swf` 导入状态 |
| 加入、移除与保存 | 原 mediator：点击卡库加入，点击卡组移除；关闭/保存时提交脏数据 | 点击或跨左右分区拖动均可加入/移除；加入受实际持有副本数限制。脏关闭提交草稿后保持窗口和脏状态，只有后续 actor 快照返回同一卡组签名才视为保存成功并关闭；失败不会丢草稿或自动关窗 |

`all=false` 从角色 `cards` 读取已拥有卡牌；角色数据同时兼容 `main:card:12` 与本地键 `12`。`all=true` 显示主数据域完整图鉴。原皮肤路径由 `OriginalUi.skin()` 解析，再由 `CocosUi` 以 `.png` 资源加载。
