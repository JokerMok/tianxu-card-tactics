# 原版界面来源映射

核对日期：2026-10-21。目标是把已验证的原版客户端布局和位图接到当前 Cocos 运行时。本文记录的是本地客户端反编译源码、FairyGUI XML、SWF 解析结果与已转换位图之间的静态证据链，不代表已取得原游戏运行截图或完成逐像素动态比对。

## 导入边界

`scripts/import-original-ui.py` 只读访问相邻的 `KingsCall-原版客户端逆向研究`。它从 `Home/HomeWnd`、`Login/LoginWnd`、`Login/CreateActorWnd`、`Login/ServerListWnd` 开始递归导入 FairyGUI 依赖闭包，并扫描指定 AS3 窗口的字符串资源引用。SWF 不在运行时执行；世界地图中没有符号名的位图，按已解析 timeline 的 `container_path + character_id` 精确选择。生成的 `cocos-client/assets/resources/recovered/original-ui/` 与 `original-ui.json` 是可重建文件，保持在 Git 忽略范围内。

当前闭包包含 60 个 FairyGUI component、185 张引用图片和 818 个可转换 skin；这些数量只证明导入范围。7 个既有缺失引用保留在 catalog 中，运行适配不会为缺失状态伪造原图。高级窗口与本轮运行差异分别见 growth-window-map.md、secondary-window-map.md。

## 页面到运行时的映射

| 页面 | 原版布局与资源依据 | 当前运行入口 | 尚未恢复的动态部分 |
|---|---|---|---|
| Home | `analysis-copy/fui/5254333329581733871/package.xml` 与 `HomeWnd.xml`；递归引用 `ActivityToolBar`、`NormalButton`、资源条、聊天条等组件 | `OriginalUi.mount('Home/HomeWnd', parent)`；通过 child id/name 绑定按钮、文本、可见性、进度和皮肤 | 原版 transition 的插值播放、滚动列表行为和服务端活动状态仍由上层业务适配决定 |
| Login / CreateActor / ServerList | `analysis-copy/fui/Login/package.xml` 及 `grrd0.xml`、`kmt27.xml`、`mamh28.xml`；保留登录控制器、逻辑 group、角色性别原图与服务器列表布局 | `OriginalUi.mount(...)`；`setController('debug', '0')`、`setController('loginState', '0')` 切换原布局状态；账号、角色和服务器数据由本机服务适配 | 原平台选服、注册、后续转职和服务器状态接口不在现有服务端证据范围内，不据静态界面伪造 |
| Package | `GamePackageUI/PackageUI/*.as` 的坐标、子面板和资源字面量；`screens.json` 保存结构化 screen 记录 | `OriginalUi.skin(...)` 和 `CocosUi.sourceButton(...)` 为包裹页适配提供原位图 | AS3 条件分支、拖放、分页和 tooltip 逻辑不会由导入器执行 |
| CardEdit | `GamePackageUI/CardEditUI/*.as` 的窗口、卡组区、筛选区和按钮资源 | 同上；业务层按 catalog skin 名绑定原布局控件 | 卡牌排序、合法性提示和拖放状态需由权威卡组逻辑驱动 |
| Smithy | `ui/smithy/*.as` 的铁匠铺窗口、分页和资源名 | 同上；只使用唯一解析或显式 container variant | 强化、分解、合成的结果与消耗必须来自当前服务，不能从 UI 推断 |
| Result | `ui/result/*.as` 的 PVE/PVP/城战结算窗口和资源名 | 同上；结算层使用服务端已确定的奖励数据填充 | 原版逐项计数动画和音效时序尚未按 AS3 逐帧复原 |
| Battle HUD | `ui/battle/BattleWnd.as`、`HandCardPane.as` 及同目录控件；原版用 `zdjm_1` 承载 849×146 手牌底板，用 `hhjs_1` 结束回合，并引用托管、头像、铲子、声音和退出资源 | catalog 提供上述唯一位图，供战斗表现层用同名 skin 绑定；通用 `BtnFactory` 的 `ajda_1` 也显式锁定到 `ui_step1.swf#168` | 手牌抬升、hover 发光、倒计时与战斗事件动画由战斗表现队列负责，静态导入不能替代时序验收 |
| WorldMap | `WorldMapWnd.as:62-109` 给出 740×450 内容区、窗口底图、标题及新旧地图按钮；`WorldMapPane.as:32-72` 和 `WorlMapPanel2.as:16-49` 给出场景 ID 顺序；`worldmap.swf#120`、`worldmap2.swf#112` timeline 给出每个地标的真实位置 | `WorldMapWindow.render(...)`；两张地图的底图和 1–19 区域图均按精确 SWF character 导入，解锁状态来自 snapshot | SWF 的 hover/按下帧、发光滤镜与等级提示动画未播放；当前保留真实静态图并用 Cocos button 状态表达可用性 |
| Scene / PVE | `SencePane.as:190-242` 给出非重复、重复、跳转触发器的尺寸和相对定位；`SceneMediator.as:149-190` 把 pathpoint 原始 x/y 直接传给窗口；场景 XML 与 catalog 保留背景、节点、trigger 和 transition | `WorldMapWindow` 直接显示 740×441 原始场景图，在 XML 坐标放置红、蓝、Go 首帧，并按 `accessible`、`cleared`、`transitions` 分派 challenge / transition | 红蓝与 Go 的多帧循环、任务旗标、通关奖励预览和体力系数面板尚未逐帧恢复 |
| PathPoint | `PathPointPane.as:50-122` 给出 472×346 弹窗、关闭、开始、金币通关和卡组管理按钮 | 场景 trigger 调用 `challenge(node)`，由现有业务层打开关卡详情并提交挑战 | `TianxuGame.openOriginalNode` 已接原 472×346 框、HTML 剧情去标签、敌人卡与开始/卡组按钮；开始按钮精确选 ui_step1.swf#177，避免同名资源中断。牌组强度、金币通关及源提示分区仍有差异，合作按钮是本地服务适配 |

## 坐标与状态约束

- FairyGUI catalog 保留左上角原点、x 向右、y 向下。`OriginalUi` 用左上锚点和 Cocos 的 y 轴方向换算节点位置，不把 XML 坐标重新排版。
- FairyGUI `group` 保持同级逻辑成员关系；隐藏 group 会递归影响其成员，但不会改变成员的绝对坐标。已恢复 `gearDisplay`、`gearXY`、`gearSize`、`gearIcon` 的运行时控制器切换，以及本批组件使用的 `width-width` / `height-height` 尺寸关系。loader 的 `autoSize=true` 使用实际位图尺寸，角色选择的横向列表据此排列。
- 世界地图地标位置来自 SWF root timeline；场景触发点来自 scene XML。场景原图实际为 740×441，因此不再使用旧实现的 `1200×720 → 920×330` 比例缩放。
- `WorldMapPane.open()` 的原规则是 `sceneId <= 当前开放 ID` 才显示可点击状态；当前适配使用服务返回的逐场景 `unlocked`，这是现有权威状态的更精确表达。节点可达、已通关、战斗或转场也只读取 snapshot。
- 导入成功只说明静态资源和结构可读。正式视觉验收仍需 Cocos 实际运行后检查资源加载、锚点、遮挡顺序、按钮命中区及不同解锁进度下的状态切换。

## 共用交互边界

正式页面的次级参数、说明弹窗使用 `NMiniPopWnd` 的 `kpglk_1`（477×346）、29px 标题带与原关闭按钮。参数内容和分页适配本地服务，不能作为原版业务表单逐像素恢复的证据。竞技赛多选显示实际卡图和选择状态；旧的大型 `modalBase/form/choose/selectDraft` 只在 `?debug=1` 中绘制。卡组悬停说明使用源 CardToolTipUI/EditBigCarPanel 的 202×276 规格。
