# 开发计划：横屏 PVE 战术卡牌游戏

## 依据与架构

以项目现状与模块化开发计划-v2.0.md 为任务来源，覆盖 M0–M8 112 个父任务及跨引擎对拍前置任务。正式运行时为 Cocos Creator 3.8.8；核心规则放 cocos-client/assets/scripts/core/，配置放 cocos-client/assets/resources/config/，战斗表现放 cocos-client/assets/scripts/battle/，元游戏与服务放 cocos-client/assets/scripts/meta/ 和 services/；React 只保留规则参考、黄金测试和体验对照。

## 阶段门

M0 工程治理 → M1 配置与基础服务 → M2 确定性战斗核心 → M3 Cocos 战斗闭环 → M4 R2 主线 → M5 R3 PVE → M6 R4 养成；M7 在 M3 表现基础上推进 UI/美术，M8 在 M5/M6/M7 后推进内容工具和发行。

M0 要求 Git 干净、根级验证、状态台账和架构方案；M1 要求配置/存档/时间/奖励契约通过；M2 要求规模、黄金测试和中立平衡通过；M3 要求真实入战回流；M4–M6 要求内容、奖励和经济闭环；M7 要求资产与性能门；M8 要求发行、安全、合规和恢复演练。

## 任务调度

.ai-dev/tasks/ 已建立 T001–T119：T001–T009 对应原 M0-01–M0-09，新增 T010 为 M1-04A 数值与政治阵营设计前置，新增 T112 为 M2-17A Cocos Golden Runner 协议前置，新增 T113 为 M2-17B 可对拍 Battle Runner 前置，T114、T115 与 T117 为已失败的独立修复记录，T116 为已完成的完整替代修复；T043 为已停止集成的 M3-07 首次实现，T118 为终局真值表契约的独立替代实现；T044 保留失败证据，T119 是其暂停/恢复托管队列的唯一替代修复，并成为 T045 的机器前置。机器调度默认按源计划顺序串行，避免共享 cocos-client/、web-prototype/、scripts/ 和资源目录的并行写入；后续只有经 context-budget、scope_guard 证明无共享写入路径，才可拆 Wave 并行。核心、跨模块、数值、经济、账号、支付、安全和最终验收使用 cloud；边界清晰的文档、测试补充和配置迁移可使用 local，但须用户明确同意。

T116、T035、T036、T037、T038、T039、T040、T041、T042、T118 已完成并通过任务级验收；T114、T115、T043、T044、T117 仅作为失败记录保留。T119 必须从已合入 T118 的协调基线新建独立 worktree，不得合入、拣选或复制 T044 失败分支的实现作为代码基线；它只修复托管队列的暂停、恢复与隐藏边界，并以 BattleSessionController 为只读状态机边界。通过 result_guard 后才可启动 T045。每个任务必须基线检查、上下文包、独立 worktree、失败测试、最小实现、回归、范围检查和独立审查。

## 迁移与回滚

React→Cocos 先保留对照，先建立协议 runner，再建立能根据高层指令独立推进 BattleState 的 Cocos Battle Runner，再统一跨引擎对拍契约与生命周期，最后进行 M2 黄金测试；M2 黄金测试后停止 React 正式实现地位。存档先建 Schema 再迁移，失败保留备份；规则冲突先写 ADR 并重新批准；本地任务失败一次后升级 cloud，cloud 任务失败一次后停止报告；不删除测试、不强推、不部署、不用 git reset --hard。

## 全局命令

    cd web-prototype && npm test
    cd web-prototype && npm run build
    cd cocos-client && npm run validate:a0
    cd cocos-client && npm run verify:meta
    cd cocos-client && npm run audit:image2

## 退出标准

主文档和任务包批准且哈希有效；任务级测试、lint、构建、范围和独立审查全通过；阶段门逐项通过；用户确认最终集成后才合并协调分支。
