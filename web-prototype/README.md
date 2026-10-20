# 天墟：万象战阵 · 规则验证原型

状态：R1 评审通过  
用途：验证 1v1 两路十二格、双方 `2×3` 召唤区、准备值、完整自动托管、自动推进和技能干预

## 运行

```bash
npm install
npm run dev
```

默认地址：http://localhost:4173/

## 布局

- 默认：A 战场优先主布局。
- `?variant=B`：内部战术仪表评审布局。
- `?variant=C`：内部沉浸战线评审布局。
- `prototype` 参数会显示布局切换器并启用 `has-switcher` 样式，改变底部留白、战场宽度和提示位置；不传 `variant` 时仍使用 A 布局。

## M0-04 冻结边界

- 本目录仅用于网页规则与交互验证，不是正式生产客户端。
- M0-04 仅冻结现有 React 原型边界：保留现有 1v1 两路十二格、双方 `2×3` 召唤区、准备值、自动托管、自动推进和技能干预验证范围。
- 后续仅修复已存在的规则缺陷或补充冻结说明；不得新增产品 UI、产品功能、正式美术或生产客户端代码。
- 卡牌立绘槽和战场单位渲染槽继续使用占位图标，正式美术以项目根目录的美术规范和首批素材清单为准。

## 校验

```bash
npm run test
npm run build
NODE_PATH=/Users/jokermok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/verify.mjs
```

该目录为网页验证原型，不是正式生产客户端。当前卡牌立绘槽和战场单位渲染槽仍使用图标占位，正式美术以项目根目录的美术规范和首批素材清单为准。
