# 首关接入实施计划
版本：1.0　日期：2026-09-06　状态：待批准

## 决策
保留 Cocos 3.8.8。先解决 Runner 顶层 Node 文件读取与全局配置依赖，维持旧 CLI 接口；之后统一会话和持久化；最后接入正式入口。不同任务不同时修改共享文件。
规则 → 会话 → 表现；终局 → 奖励事务 → 存档。画面不能提交任意胜负布尔值。

## 批次
|批次|任务|依赖|输出|
|---|---|---|---|
|Wave 1|T401|无|浏览器可用核心与 CLI 兼容包装|
|Wave 2|T402|T401|首关会话、幂等结算、刷新恢复|
|Wave 3|T403|T402|正式入口、界面状态绑定、实玩验收|

任务详情见 tasks/T401.md、tasks/T402.md、tasks/T403.md 及同名 JSON。执行者均为独立 Codex 子智能体；每个任务另设未参与实现的审查者。实现上下文 8000 token，审查 10000 token，扩展须记录路径、原因和预算。
每任务执行 scope_guard snapshot/check、context_pack、测试与独立审查；协调器写结果并运行 result_guard。未通过不启动后续任务。

## 基线与计划激活
源项目：横屏战术卡牌原型。此目录是候选计划包，不是独立仓库，不替换现有 v2.2 计划或继承其审批。
用户批准此版本后，协调器在原仓库完整备份旧三份计划、任务与审批，再安装此版本至根 .ai-dev；不删除任何结果或未跟踪文件。通过 plan_lint 和 scheduler 后由协调器签发审批收据，再建立协调分支与独立任务 worktree。如基线变化需复核，不伪造原审批。
不把新任务混入旧未完成 DAG，否则旧阻塞会被误当成新任务依赖。旧产品范围保留为后续路线图，本计划仅授权首关验证。

## 验证命令
每任务执行 JSON 中命令。T403 负责新增无 UI 构建包装 tools/build-p0.sh，定位 Dashboard 安装的 3.8.8，输出隔离构建与日志，不抢占编辑器。
全局回归：cd web-prototype && npm test && npm run build
Cocos 回归：cd cocos-client && npm run test:battle-runner && npm run test:battle-runner:types && npm run test:golden-runner && npm run test:parity-contract && npm run validate:a0 && npm run validate:config-loader && npm run validate:config-cross-table
新增验证：cd cocos-client && node --experimental-strip-types tools/test-browser-battle-core.mjs && node --experimental-strip-types tools/test-campaign-session.mjs && node --experimental-strip-types tools/test-p0-entry.mjs && bash tools/build-p0.sh
浏览器人工或自动化证据按 TEST-409 保留；HTTP 200 不代表验收通过。

## 回滚与发布
任务分支和协调分支保留，不合并主分支、不推送、不发布。功能失败时切回旧构建，不抹除新旧存档，不清理 worktree。存档写入失败停止提交，禁止 UI 先发奖再补存盘。
独立审查存在 P0/P1/P2 时禁止放行。初次失败修复一次，仍失败报告证据并暂停；不无限重跑掩盖错误。

## 对抗式复核与复盘规则
已将 Node-only 运行器、全局配置串局、卡牌 ID 不一致、重复奖励、恢复时二次扣费、旧动画回调污染新局、仅测辅助入口等风险纳入需求和测试。
上一轮模块测试不能证明入口接通；本轮固化“正式入口→规则终局→存档→重入”为验收链。复盘在通过后写入根 .ai-dev/retrospective.md。
未排入：美术重做、十二关铺开、PVE 商城、数值平衡、账号与平台迁移。

