# 组件、资源与真实接口

| 原预览能力 | 正式实现 | 接入关系 |
|---|---|---|
| PreviewUi / 原图节点 | CardManagementUi.ts | 原材质、文字角色、按需纹理与引用释放。对Cocos目标编译器使用Array.from处理Map/Set，避免迭代器被当单个数组项。 |
| ScrollRegion | CardScrollRegion.ts | Mask、滚轮、滚动条、独立滚动偏移；每栏15槽。 |
| CardManagementPreview 的书本/手势/详情 | CardDeckWindow.ts | 已替换原分页主实现。固定标题、筛选、数量、保存，独立拖影和全矩形落点。无正式预览双逻辑依赖。 |
| 模拟草稿/定时保存 | DeckDraft.ts + TianxuGame.saveDeck | 按角色保存会话、提交快照、真实ACK基线、不确定请求原ID重试。没有模拟成功/失败开关。 |
| content-zh / 映射 | GameText.ts + resources/localization/game-zh.json | 静态源ID与raw保持，展示字典共用到卡组、详情、手牌、单位、奖励、成长/次级选择。 |
| 无字派生素材 | resources/ui-revision-a/ | 三个文件，从原预览逐字复用；provenance.json记录来源/哈希。原导入目录只读。 |

正式入口：TianxuGame 的主城 kpBtn / tjBtn → CardDeckWindow。退回、角色变更和轮询由原客户端协调；后台刷新只同步当前角色权威数据，不重建正在编辑的窗口。退出组件后释放可见节点，最后销毁缓存，迟到的图片请求不会复活已销毁纹理池。

接口继续使用 GET /api/catalog、GET /api/state、POST /api/act。deck.save 增加返回确切确认cards；state增加现行actorLevel规则导出的deckCapacity。没有新增服务、存档体系、数据库schema或规则分支。服务端validateDeck、事务与幂等记录继续负责真实校验。

正式素材由同一游戏服务 `/ui-assets/` 提供；原图继续 `/recovered/`。没有依赖7405预览服务、预览数据、本地模拟保存键或录屏网关。7410最终运行直接连接原服务；临时故障网关已停止。

构建沿用 cocos-client/tools/build-p0.sh，将真实入口依赖暂存到.local后调用本机Creator；不重新导入客户端。显示词典可用 `python3 scripts/build-game-localization.py` 从本次提交的映射重新合成，无模型、网络或私有census依赖。改词典后需重启服务并刷新客户端；改TS需重新Cocos构建。名称候选与组合效果经离线草稿和人工翻译/复核混合产生，细节按各歧义文档记录，不把完整性检查称语义定稿。

回退检查点：codex/checkpoint-before-ui-integration-20261022 指向接管HEAD。未提交状态补丁、既有评审文件、SQLite在线一致性备份与旧web构建保存在.local/ui-integration/checkpoint-20261022/。本轮提交只在本地集成分支；回退应在独立工作树或备份目录验证，不在当前工作区reset或覆盖存档。
