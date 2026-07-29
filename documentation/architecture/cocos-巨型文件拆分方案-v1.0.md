# Cocos 巨型文件拆分方案

版本：v1.0
任务：T005 / M0-05
需求：REQ-R0
状态：方案已登记，未执行代码迁移
基线：`cocos-client/assets/scripts/meta/GameShell.ts`、`cocos-client/assets/scripts/a0/BattleA0Bootstrap.ts`、`cocos-client/assets/scripts/meta/GameState.ts`

## 1. 范围与判断

本文件只完成拆分设计，不修改 Cocos 代码，不新增运行时类。设计依据是当前工作区的真实文件和生效开发计划。

当前事实：

- `GameShell.ts` 约 865 行，构造函数接收 `host: Node`、`battleRoot: Node`；`mount()` 同时完成元游戏根节点创建、页面渲染、战斗入口和全局测试 harness 注册。
- `GameShell.ts` 还直接持有 `GameState`，调用 `loadGame`、`resetGame`、奖励、任务、建筑、远征和卡牌升级函数，并在 `enterBattle` / `returnFromBattle` 中切换战斗状态。
- `BattleA0Bootstrap.ts` 约 895 行，是 Cocos `Component`。`onLoad()` 同时设置分辨率、建场景、注册 harness、加载资源和创建 `GameShell`；同一文件还处理 HUD、棋盘、主将、手牌、部署、单位预览、压力模式、命中反馈和指标发布。
- 当前战斗表现使用占位图形与 A0 资源加载；`unitPreviewEntries` 的 idle breathing、`stressMode` 和 `__A0_*__` 全局入口均属于现有 harness / A0 原型，不等同于正式战斗内核。
- `GameState.ts` 当前既定义元游戏状态，又实现 `localStorage` 读写和元游戏操作。计划要求未来在 `assets/scripts/core` 建立禁止引用 `cc` 的领域层，但该目录当前不是本任务的实现范围。

因此，M0-05 的交付物是可执行的职责边界和迁移顺序，而不是“拆分已完成”的代码变更。

## 2. 目标目录

以下是迁移目标，不代表当前目录已经存在：

```text
cocos-client/assets/scripts/
├── meta/
│   ├── GameShell.ts                 # 保留薄编排入口
│   ├── GameShellController.ts      # 页面、战斗入口和外部 harness 编排
│   ├── GameShellState.ts            # 页面选择与元游戏视图状态
│   ├── meta/
│   │   ├── MetaStateService.ts      # 元游戏状态读写门面
│   │   └── MetaActionService.ts     # 元游戏动作门面
│   └── ui/
│       ├── MetaChromeView.ts        # 背景、顶栏、导航、返回条
│       ├── MetaPageView.ts          # 页面和动态覆盖层
│       ├── MetaHotspotBinder.ts     # 热点与页面动作绑定
│       ├── MetaAssetLoader.ts       # 页面图片和卡牌资源加载
│       └── MetaUiPrimitives.ts      # node/panel/label/button/hotspot 等工厂
├── a0/
│   ├── BattleA0Bootstrap.ts         # 保留 Cocos 生命周期薄入口
│   ├── BattleSceneView.ts           # 场景根、背景、HUD、棋盘、主将、手牌
│   ├── BattleBoardView.ts           # 格子、部署标记、单位层
│   ├── BattleHandView.ts            # 手牌、选中态、技能图
│   ├── BattleCommanderView.ts       # 双方主将及命中反馈
│   ├── BattleUnitView.ts            # 单位节点和预览 idle
│   ├── BattleA0AssetLoader.ts       # A0 资源加载、裁切和 pose 帧
│   ├── BattleA0InteractionController.ts # 选牌、部署、命中、压力模式
│   └── BattleA0Harness.ts           # 指标和现有 __A0_*__ 测试入口
└── core/                            # 后续 M2，当前不存在且不在本任务中创建
```

`GameState.ts` 的进一步拆分应由状态/配置相关任务单独决定；本方案只规定 `meta` 层通过门面依赖它，避免让视图直接调用存档和奖励函数。

## 3. GameShell 拆分表

| 目标类 | 当前方法或字段归属 | 职责 | 输入 | 输出 / 副作用 | 依赖方向 |
|---|---|---|---|---|---|
| `GameShell` | `constructor`、`mount` 的生命周期编排 | 接收宿主、组装控制器并启动元游戏 | `host: Node`、`battleRoot: Node`、依赖对象 | 无业务状态；调用 `mount()` | 依赖 `GameShellController`，不被视图依赖 |
| `GameShellController` | `mount`、`navigate`、`enterBattle`、`returnFromBattle`、`openSettings`、全局 harness 注册 | 串联状态、视图和战斗回流 | 页面、战斗阶段/模式、胜负 | 更新状态；请求视图刷新；调用 battleRoot 开关 | 依赖 `GameShellState`、`MetaStateService`、`MetaPageView`、`MetaChromeView` |
| `GameShellState` | `state`、`page`、`selectedCard`、`activeStage`、`battleMode` | 保存当前元游戏会话状态 | `GameState`、`PageId`、选择项 | 只返回状态快照，不写 Cocos 节点 | 被 controller 依赖；不依赖 `cc` 业务 API |
| `MetaStateService` | `loadGame`、`resetGame`、`saveGame` 的调用边界 | 提供状态读取、重置和保存门面 | 当前状态、重置请求 | `GameState` 或保存结果；持久化由现有 `GameState` 实现承担 | 依赖 `GameState.ts`；禁止视图反向依赖 |
| `MetaActionService` | `upgradeBuildingFromArt`、`claimTaskFromArt` 及各动作调用 | 将点击动作转成状态操作 | 卡牌/建筑/任务/远征/关卡 ID | 状态变更、奖励和保存请求 | 依赖 `GameState.ts` 导出的动作；不依赖 `Node` |
| `MetaChromeView` | `drawBackdrop`、`drawTopBar`、`resource`、`drawNavigation`、`drawBattleToolbar`、`renderChrome` | 绘制固定外壳和导航 | `Node` 宿主、只读页面/状态、回调 | Cocos 节点树 | 依赖 `cc`；只向 controller 发回调 |
| `MetaPageView` | `renderPage`、`drawDynamicStateOverlays`、`dynamicPatch`、`renderHome`、`renderCampaign`、`renderCards`、`renderDeck`、`renderHero`、`renderAdventure`、`renderCity`、`renderTasks`、`renderInventory`、页面辅助行/卡片方法 | 绘制页面及状态覆盖层 | `GameState`、`PageId`、`selectedCard`、动作回调 | 页面节点、资源加载请求 | 依赖 `cc`、`GameState` 类型和 `MetaAssetLoader`；不调用状态变更函数 |
| `MetaHotspotBinder` | `drawNavigationHotspots`、`drawPageHotspots`、`setPointerCursor` | 把页面区域绑定到 controller 回调 | 页面、坐标、回调 | 交互节点和指针状态 | 依赖 `cc`；回调指向 controller |
| `MetaAssetLoader` | `loadSprite`、`cardArt` 的资源加载部分 | 统一页面背景和卡牌 SpriteFrame 加载 | 资源路径、目标节点、尺寸、回调 | 异步填充 Sprite；失败只记录并保留占位 | 依赖 `cc.resources`；不依赖状态服务 |
| `MetaUiPrimitives` | `node`、`panel`、`label`、`button`、`hotspot`、`pageTitle`、`quickTile`、`modePanel`、`settingRow`、`progressRow`、`ruleRow`、`statRow`、`rewardChip`、`toast` | 提供低级 Cocos UI 工厂 | 父节点、尺寸、文案、样式、回调 | `Node` | 仅依赖 `cc`；不依赖 GameState 或 controller |

拆分后的依赖链应保持为：

```text
GameShell → GameShellController → {GameShellState, MetaStateService, MetaActionService}
                                   ↓
                         {MetaChromeView, MetaPageView, MetaHotspotBinder}
                                   ↓
                         {MetaAssetLoader, MetaUiPrimitives}
```

视图只能通过回调向上报告意图；`MetaPageView` 不得直接调用 `saveGame`、`grantReward` 或其他状态动作。

## 4. BattleA0Bootstrap 拆分表

| 目标类 | 当前方法或字段归属 | 职责 | 输入 | 输出 / 副作用 | 依赖方向 |
|---|---|---|---|---|---|
| `BattleA0Bootstrap` | `onLoad`、`onDestroy`、`update` 的生命周期壳 | 设置分辨率、创建各协作者、转发帧更新和销毁 | Cocos `Component` 节点、配置 | 场景可见；清理 harness | 依赖各 view/controller/loader/harness；不实现具体绘制 |
| `BattleSceneView` | `buildScene`、`drawBackground`、`drawHud`、`drawCommanders`、`drawHand` 的组装部分 | 建立 A0 场景层级和固定表现 | 根节点、A0 布局配置 | `BattleSceneRefs`（root、board、unitLayer、主将、手牌等） | 依赖 `cc`；向 controller 暴露事件回调 |
| `BattleBoardView` | `drawBoard`、格子和 `deploymentMarkers` 的管理 | 绘制 2×12 棋盘、召唤区、部署标记和单位层 | 棋盘尺寸、格子配置、部署回调 | 格子点击事件、标记显隐、单位父层 | 依赖 `cc`；不计算战斗规则 |
| `BattleCommanderView` | `createCommander`、`playerCommander`、`enemyCommander`、`enemyFlash`、敌方 HP 表现 | 绘制双方主将和受击反馈 | 阵营、文案、颜色、HP、命中回调 | 主将节点、HP 更新、闪白动画 | 依赖 `cc`；不修改 BattleState |
| `BattleHandView` | `drawHand`、`selectCard`、`setCardLift`、`drawSkillArt`、手牌数组和选中光效 | 绘制手牌并维护选中视觉 | 卡牌摘要、选中索引、资源加载器、选牌回调 | 选中索引和手牌节点 | 依赖 `cc`、`BattleA0AssetLoader`；不决定合法性 |
| `BattleUnitView` | `spawnInitialUnits`、`spawnUnit`、`attachUnitPreview`、`refreshUnitPreviews`、`unitPreviewEntries` | 创建单位表现和 idle pose | 单位展示数据、格位、阵营、SpriteFrame | 单位节点、预览更新 | 依赖 `cc`；不持有规则状态 |
| `BattleA0AssetLoader` | `loadRuntimeArt`（现由调用方触发）、`loadSpriteFrame`、`attachBackgroundArt`、`attachCommanderArt`、`attachHandArt`、`createCenterCrop`、`createPoseFrames`、`createKeyedPoseSheet` | 加载 A0 图片并生成预览帧 | 资源路径、目标引用、裁切比例 | 异步 SpriteFrame / pose 帧、资源计数 | 依赖 `cc.resources`；被表现类依赖 |
| `BattleA0InteractionController` | `deploySelected`、`triggerEnemyHit`、`enableStressMode` 及事件转发 | 接收选牌、部署、命中和压力模式意图 | 选中卡、格位、阵营、事件回调 | 更新表现请求和 harness 状态 | 依赖 view 接口；不得把占位扣血当正式战斗规则 |
| `BattleA0Harness` | `publishHarness`、`updateMetrics`、`metrics`、`__A0_*__` 入口、`A0Metrics` | 保留现有 A0 校验和压力观测入口 | 当前视图快照、资产状态、命中/部署事件 | `__A0_METRICS__` 等全局测试接口 | 依赖表现只读数据；不得反向控制业务服务 |
| `BattleA0Math` | `smoothstep`、`addTransform` 中的纯计算部分 | 承载裁切、动画和尺寸计算 | 数值和布局参数 | 数值结果 | 只依赖基础 TypeScript；可被表现类依赖 |
| `BattleUiPrimitives` | `createButton`、`createPanel`、`createGraphicsNode`、`createLabel`、`addTransform` | 提供战斗低级节点工厂 | 父节点、尺寸、样式、回调 | Cocos 节点或组件 | 仅依赖 `cc`；不依赖 controller 或状态 |

战斗层依赖链应保持为：

```text
BattleA0Bootstrap → BattleSceneView → {BattleBoardView, BattleCommanderView, BattleHandView, BattleUnitView}
                                      ↓
                              BattleA0AssetLoader
BattleA0InteractionController → 各表现接口
BattleA0Harness → 各表现接口（只读观测）
```

`BattleA0Bootstrap` 可以创建 `GameShell`，但 `BattleA0` 不得反向调用 `GameShell` 的私有渲染方法。正式战斗接入后，二者通过领域事件或明确的场景接口通信；当前 M0-05 不创建该领域层。

## 5. 输入、输出和边界

### 5.1 当前输入

- Cocos 节点、`cc` 组件、分辨率和 A0 资源路径。
- `GameState` 及其当前导出的元游戏动作函数。
- 当前全局 harness 名称：`__META_*__`、`__A0_*__`，以及 `A0Metrics` 字段。
- 生效计划规定的方向：领域层禁止引用 `cc`，表现层只消费领域事件，策划数据不得继续硬编码在界面代码中。

### 5.2 迁移后输出

- 两个原入口仍可挂接到现有场景，外部调用方式和 A0 harness 名称保持兼容。
- 元游戏状态更新、战斗进入/返回、页面导航和现有视觉表现保持可回归验证。
- 新类按表格职责拆分；视图不直接持久化，不直接承担规则计算。

### 5.3 明确不属于本任务

- 不创建 `scripts/core`，不实现 BattleState、行动、移动、攻击、结算或 AI。
- 不把 React 规则实现搬入 Cocos，不把 A0 压力模式或测试扣血入口写成正式战斗闭环。
- 不进行 UI 组件库、资源目录重排、性能优化、Android 适配或后续 M1–M7 任务。

## 6. 迁移顺序

每一步均应先保持旧入口可用，再切换一个职责，完成回归后进入下一步：

1. **冻结契约**：记录现有入口构造方式、场景节点名、全局 harness 名称、`A0Metrics` 字段、默认页面和现有验证命令结果。
2. **先抽低级工厂与资源加载**：从两个文件抽出 `MetaUiPrimitives`、`BattleUiPrimitives`、`MetaAssetLoader`、`BattleA0AssetLoader`。这一步不改变页面或战斗行为。
3. **拆表现子视图**：依次迁移元游戏 chrome、页面、热点，再迁移战斗棋盘、主将、手牌和单位表现。每次只替换一个调用簇。
4. **拆控制与状态边界**：引入 `GameShellState`、`MetaStateService`、`MetaActionService`，把页面视图中的状态动作改为回调；保留 `GameState.ts` 作为当前存储实现。
5. **拆 A0 交互与 harness**：将选牌、部署、命中、压力模式和指标发布移入 controller/harness，保留已有全局入口和字段语义。
6. **收薄入口**：`GameShell` 和 `BattleA0Bootstrap` 只负责依赖组装与 Cocos 生命周期；删除旧文件中已经迁移的方法，确认无循环依赖后再提交。

后续 M2 才能让 `BattleA0InteractionController` 改为消费 `scripts/core` 的领域事件；在此之前不得伪造该依赖已存在。

## 7. 回滚边界

- 本任务的可回滚单位是当前 T005 commit，回滚只撤销 `documentation/architecture/` 下本方案文件；不得触碰 `cocos-client/`、`web-prototype/`、`.ai-dev/` 或其他任务提交。
- 未来执行代码迁移时，每个步骤应单独 commit，并以“旧入口仍可运行、三项验证通过、工作区路径合规”为切换条件。任何一步失败，回滚到上一个通过验证的拆分 commit。
- 允许保留旧入口作为临时适配壳，直到新类通过同一组验证；禁止为了通过验证删除断言、改写测试入口或把失败吞掉。
- 若发现 `GameShell` 与 `BattleA0Bootstrap` 的实际接口、场景节点或 harness 契约已变化，应停止迁移，重新核对基线，不在本方案范围内自行扩大修复。

## 8. 验收记录

本任务只新增本文件，不填写 `.ai-dev/results/T005.json`。

| 命令 | 退出码 |
|---|---:|
| `cd web-prototype && npm test` | 127（`vitest` 未安装，命令未启动） |
| `cd web-prototype && npm run build` | 127（`tsc` 未安装，命令未启动） |
| `cd cocos-client && npm run validate:a0` | 0（`A0 manifest and scene contract: PASS`） |

两条 Web 验证未通过的原因是工作区没有 `web-prototype/node_modules/`；按本任务“仅允许修改 `documentation/`”的边界，未安装依赖。`git diff --name-only` 与 `git status --short` 还需确认只出现 `documentation/`，且提交为独立 commit。
