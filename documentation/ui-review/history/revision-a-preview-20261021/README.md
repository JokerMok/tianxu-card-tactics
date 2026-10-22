# 游戏UI评审 · A修订版

当前唯一方案：**中文展示＋竖向滚动＋干净组件化界面**。旧A/B、固定9张分页和正式保留英文名的规格已被替代，历史资料保留在history及旧报告中。

- [可交互独立Cocos预览](http://127.0.0.1:7405/?fresh=1)
- [截图、录屏与边界说明](revision-a/review.html)
- [调整规格](proposal.md) · [开发映射](implementation-map.md)
- [中文来源、候选译文及缺失项](revision-a/localization.md)
- [实测记录](revision-a/validation.md)

## 本轮结果

Cocos Creator 3.8.8独立项目、真实Canvas渲染；背景/图框/卡图/动态文字/按钮/滚动区域分别组织。没有用旧整页截图作底图。卡组、持有/图鉴、详情独立滚动；卡组数量、筛选和保存保持固定；可跨栏拖放，非法落点取消。

预览以隔离的模拟状态工作：初始5张、容量11；“滚动样本”24张/模拟容量30；保存延迟与失败开关均明确标示。不连接游戏服务，不读取或修改个人存档。图鉴183条真实源记录的中文展示中，候选翻译有独立来源标记，未覆盖的9137条不冒充完成。

## Skill

全局独立副本：`~/.agents/skills/game-ui-design/`。源仓库jeremylongworth-source/AgentSkills，锁定45f314d2a3d3201dd5a0304a3a4f3a5f23a905a2，MIT。已从项目外/private/tmp调用Codex skills/list并forceReload，识别为enabled用户技能，见skill-discovery.json。项目同名副本移到发现目录外备份；没有关闭其他任务。

## 运行

当前服务仅监听本机7405。干净审阅包内有可直接运行的web构建与素材；用已安装Node运行 `node revision-a/source/serve-preview.mjs`，或双击start-preview.command，再访问7405。若已有该端口服务直接复用，不关闭其他游戏入口。

修订前截图来自b728539原CardDeckWindow组件，与新预览共用相同5张卡组和持有数据；不是原游戏官方实机截图。新滚动布局是本轮体验优化，不称已证明的原版行为。

正式游戏源码与后端保持原样；分支HEAD仍为b7285398b92b85705a2ea5e69b28b5cd01bb2e3d。本轮没有提交、推送或正式合并。旧ui-review.zip是历史产物，不作为当前交付；当前包为ui-review-revision-a.zip。
