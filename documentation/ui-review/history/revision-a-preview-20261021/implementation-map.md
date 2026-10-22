# A修订版开发映射

旧A/B映射已归档到 `history/review-v1/`，不再是实施标准。本轮结果是独立 Cocos 预览，正式游戏未合并。

| 层 | 本轮独立预览文件 | 已实现内容 | 以后合入正式游戏时的落点 |
|---|---|---|---|
| 中文展示数据 | `revision-a/source/prepare-preview.py`、`content-zh.json`、`content-mapping.json` | 183条原卡记录，中文/原名/稳定ID/源行分离，32个效果候选译文 | 新增只读本地化适配层，接入RecoveredContent展示；不改源表/服务规则 |
| 资源和文字 | `source/PreviewUi.ts` | 原卡图、框、按钮独立节点；按文字角色排字；纸面/深底分别用色；纹理按需加载与引用释放 | CocosUi/OriginalUi增量迁移，保留旧调用的兼容性；无字派生资产单独登记 |
| 独立滚动 | `source/ScrollRegion.ts` | Mask裁剪、滚轮/触控板、可见滚动条及拖动；内容不足不滚 | CardDeckWindow中卡组、持有/图鉴、详情区域各自复用 |
| 虚拟卡牌列表 | `source/CardManagementPreview.ts` 的makePane/paint | 每栏15个固定槽位，滚动时重新绑定数据，不一次创建183张卡节点 | 以独立列表/呈现器类替代deckPage/page分页，不改变卡牌ID和持有数据 |
| 拖放 | 同文件gesture/moveGesture/endGesture | 固定槽位维持手势监听，独立拖影，完整目标矩形判定，非法/窗口外释放取消 | 替换CardDeckWindow只判横坐标的结束路径；保留原权威校验 |
| 固定详情 | 同文件select/detailBody | 中文长名、多段效果完整换行，单独滚动，阅读偏移保留 | 替换仅MOUSE_ENTER/LEAVE生命周期的tooltip，增加固定查看模式 |
| 保存/数量 | 同文件add/remove/save/refreshStatus | 未保存、保存中、失败、成功和原因；全部明确标为模拟 | 用真实save回调和服务器回读替换模拟定时器，不复用模拟结果冒充真实成功 |
| 同数据前后对照 | `?baseline=1`、只读复制的baseline组件 | b728539原CardDeckWindow与新预览共享同一fixture，初始5/11 | 只作历史对照；正式游戏源码未修改 |

## 当前验收范围

用真实浏览器操作独立Cocos构建，在1200×600和桌面尺寸检查。记录见 [validation.md](revision-a/validation.md)，录屏和前后截图见 [评审入口](revision-a/review.html)。覆盖独立滚动、长说明、筛选/选中/草稿保持、跨栏拖入/移除、非法释放取消、未持有原因、24张卡组滚动、保存中/失败/重试。尚未完成的检查如有，必须在validation中单列，不以代码推断写成实机通过。

只对本轮预览做必要类型检查和Cocos构建，不运行正式游戏全量回归。此预览不连接服务端，未验证新的联机/事务行为，也没有改战斗手牌、战场、模型和动画。

## 下一步边界

1. 用户先体验唯一主方案“A修订版”。
2. 确认后再逐步把中文适配、滚动容器、列表复用、详情和反馈接入正式CardDeckWindow；保留全部既有功能。
3. 接入真实保存后补对应失败/重连/回读与存档回归。中文候选术语在正式发布前确认。
4. 本轮未授权正式合并、修改服务端规则或推送仓库。
