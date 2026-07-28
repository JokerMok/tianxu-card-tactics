# 两路战场网页原型

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
- `?prototype&variant=B`：内部战术仪表评审布局。
- `?prototype&variant=C`：内部沉浸战线评审布局。

## 校验

```bash
npm run test
npm run build
NODE_PATH=/Users/jokermok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/verify.mjs
```

该目录为网页验证原型，不是正式生产客户端。当前卡牌立绘槽和战场单位渲染槽仍使用图标占位，正式美术以项目根目录的美术规范和首批素材清单为准。
