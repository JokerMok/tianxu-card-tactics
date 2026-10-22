# A 修订版正式开发映射

2026-10-22 已执行用户授权接入。此前“仅独立预览、待授权后实施”的映射归档到history/revision-a-preview-20261021；当前只有一套正式卡组逻辑。实际文件和接口见 [正式映射](../ui-integration/implementation.md)，实机结果见 [验收记录](../ui-integration/validation.md)。

实施顺序已完成：共享中文与资源/文字层（GameText、CardManagementUi）→独立ScrollRegion和DeckDraft→正式CardDeckWindow入口与真实保存→战斗/奖励及成长等名称复用。预览素材逐字迁移，原图保持只读；没有截图叠层。

后续只处理用户体验发现的问题、候选译文与源文缺口，不自动开始新设计或全游戏重构。用户确认体验后，再另行决定合并和发布；本轮不推送。
