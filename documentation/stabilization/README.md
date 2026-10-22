# A 修订版中文与服务端稳定化

本轮基于本机 `dcd7f95`，继续分支 `codex/stabilize-ui-chinese-server`。集成前检查点分支为 `codex/checkpoint-before-stabilization-20261022`。既有未跟踪评审资料、个人库和原始素材留在原处；本轮仅使用 `.local/stabilization/` 下隔离测试库。

卡组 A 修订版继续作为正式入口，不另做预览。中文、滚动、拖放与保存成果保留；本轮补齐恢复、防重、备份与部署准备。**本地定向验收与用户体验验收分别记录，尚未获得用户体验确认。没有合并 main、推送或公网部署。**

## 入口与启动

本轮隔离游戏：[正式游戏 7420](http://127.0.0.1:7420/?client=stabilization&metrics=1)。已登录的评审标签使用隔离账号。私有账号资料只存 `.local/stabilization/identity.json`，不进入本目录或提交。

前端已构建；从项目根目录启动现有服务即可，不重新导入研究目录：

```bash
TIANXU_PORT=7420 TIANXU_DATABASE="$PWD/.local/stabilization/acceptance.sqlite" TIANXU_LOG_DIR="$PWD/.local/stabilization/logs" node scripts/start-game.mjs
```

首次启动测试夹具只使用本地 `.local/stabilization/acceptance-server.mjs`；交付入口使用同一正式服务代码，不依赖该夹具。个人 `backend/data/tianxu.sqlite` 未用于本轮测试。

## 结果与资料

- [中文校对](chinese-finish.md)：1,852 个原名按词族检查，修正62个候选名；名字来源状态保留。多数候选尚未人工定稿。
- [缺失说明和规则](rule-descriptions.md)：10条效果改为有配置/执行依据的“本版本说明”；50810可执行。另13张持续地形牌缺少生命周期实现，明确禁止施放且不消耗牌，**仍是功能缺口**。
- [服务端变化](server-changes.md)：角色/卡组冲突保护、持久请求重试、结算唯一账本、迁移、归档、备份恢复、异常与追踪。
- [验证记录](validation.md)：真实 Cocos 操作、两账号、断网、恢复、结算、备份和独立运行包；自动化结果只证明其对应范围。
- [部署准备](deployment.md)、[运行说明](../../deploy/game/README.md)、[资源白名单](../../deploy/game/resource-manifest.json)。

完整中文计数仍使用原位置 [chinese-coverage.json](../ui-integration/chinese-coverage.json)，避免另立冲突口径。7032条有效卡牌全部有展示映射：名称113条有恢复字段/上下文依据、6919条候选；2804条关联效果中2792候选、2恢复、10本版本说明；750条技能说明中103恢复、633候选、1本版本说明、13本版本限制。缺失数组为空不代表这些规则都已实现，更不代表官方中文全量恢复。

## 保留的边界

原版运行截图尚未取得；本目录截图均为本项目真实 Cocos 运行结果，派生去字素材不冒充原版原件。卡牌原始ID、原名与配置不因中文展示改变。地图滚动和现有战斗调度未重做。

13张地形牌、候选译名的独立编辑定稿、主城宣传图内少量英文标识、其他尚未收尾的剧情原文、长期压力和公网真实网络条件仍未完成。既有角色选择模板重叠等非本轮卡组/结算范围的视觉差异未在本轮扩展重做。重试协议兼容旧调用方的限制及状态视图体积见服务端记录。

本地中文UI提交：`58caa7e`。服务端及最终验证为随后独立提交，见本分支Git日志。独立运行包实际路径：`.local/stabilization/runtime`（约969.3MiB），不含数据库、私有账号或运行缓存；资源白名单和包哈希见 runtime-package.json。
