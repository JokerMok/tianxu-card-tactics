# Cocos Creator 2D A0

使用 Cocos Creator 3.8.8 建立的 Web Desktop PVE 可玩原型。启动后进入主城，已接入主线征战、卡牌背包、出战编队、主将装备、副本/挑战塔/Boss、营造远征、任务和行囊，并与 `2×12` 战场形成进入、结算和本地存档闭环。账号、云存档、支付和运营后台仍属发行阶段。

九个元游戏页面已采用 `美术素材/UI全界面/Image2-v1` 定稿作为完整视觉底层，并在 Cocos 中配置独立透明交互层。页面构图、角色、材质、文字与装饰不再由运行时代码重绘，避免实现画面与定稿产生偏差。

交互层提供页面淡入收束、导航与操作区悬停玉光、金线强调、按压回弹、指针状态和渐隐提示。全部反馈只在交互期间显示，静止状态仍保持定稿画面。

## 命令

```bash
npm run validate:a0
./tools/build-web.sh
python3 -m http.server 4180 -d build/web-desktop
A0_BASE_URL=http://127.0.0.1:4180 npm run verify:web
A0_HEADLESS=false REQUIRE_ABSOLUTE_PERF=1 A0_BASE_URL=http://127.0.0.1:4180 npm run verify:web
npm run verify:meta
```

当前资源状态为 `preview-pose`。U002、U008 在 Web 加载阶段由灰幕姿势板生成透明预览纹理；该结果不替代正式透明切片。C009、C001 使用无背景窄幅侧位战场立绘，运行时以原始宽高比计算显示尺寸，禁止固定宽高拉伸。E104 同一母图分别承担远景、双路路面和下半屏地面，人物与手牌不再压在独立纯色平台上。A0 采用战场优先布局，双方生命状态分置顶部两侧，战斗控制集中于中央，手牌固定贴近底部安全区。压力 Harness 使用 24 个独立透明 Sprite，以固定站姿和独立呼吸位移验证运行时成本，不再使用 Graphics 批次占位。战场不常驻显示阵营色部署框，选中单位牌时仅显示六个金色合法落点短标，部署后自动隐藏。无头 Chromium 使用 SwiftShader，只承担功能回归；正式性能闸门必须使用有头硬件加速模式。C009、C001 仍无骨骼数据，正式 Spine 资产到位后从现有适配层替换。
