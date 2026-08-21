# T326 M8-12-STABILITY 发布前稳定性演练

## 目标

对发布前配置契约、章节资源链路和长时运行状态进行可复验演练。验证器只报告真实断言结果，不以文件存在或固定文本代替通过条件。

## 验证范围

验证器：`cocos-client/tools/release/stability/verify-stability.mjs`

真实读取目标：

- `cocos-client/assets/resources/config/manifest.json`
- `cocos-client/assets/resources/config/` 下由 manifest 声明的配置表和章节资源
- `cocos-client/assets/a0-manifest.json`
- `cocos-client/tools/test-r2-stability.mjs`，执行 1,800 tick 长时运行、60 场战斗、检查点恢复、持久化回滚、异常恢复和负例断言

## 样本与门槛

| 样本 | 输入 | 必须成立 |
| --- | --- | --- |
| 通过样本 | 真实 manifest、章节索引、章节配置、A0 manifest、R2 稳定性脚本 | 文件可读、JSON 合法、资源引用存在、L01–L12 链路连续、A0 压力阈值有效、R2 脚本退出码为 0 |
| 缺失样本 | `manifest.missing.json` | 真实读取返回 `ENOENT` 并被断言为拒绝 |
| 非法样本 | 真实 manifest 的 `enabled` 改为字符串 | 契约拒绝错误类型 |
| 越界样本 | 真实 A0 manifest 的 `minimumFps` 改为 `targetFps + 1` | 压力阈值拒绝错误 |
| 链路反例 | 真实 manifest 的 cards 资源改为不存在路径、章节 L02 前置改为 L12 | 资源缺失和章节顺序错误均被拒绝 |

## 复验命令

```sh
cd cocos-client && node --experimental-strip-types tools/release/stability/verify-stability.mjs
```

验收条件：命令退出码为 `0`，同时出现真实发布契约通过、R2 长时演练通过、缺失/非法/越界反例通过、T326 总结通过四类输出。

## 本次演练结果

指定命令退出码：`0`

```text
T326 real release contracts: PASS (manifest tables=8, levels=12, real chapter resources=12, A0 stress units=24)
  positive PASS: R2 long-run harness (1800 ticks, 60 battles, 7 rollback checks, 32 negative cases)
  negative PASS: missing real manifest file
  negative PASS: invalid manifest enabled type
  negative PASS: out-of-range A0 minimum FPS
  negative PASS: missing declared real resource
  negative PASS: out-of-order chapter prerequisite
T326 stability rehearsal: PASS (real files, long-run sample, missing/invalid/out-of-range counterexamples, rollback evidence)
T326 conclusion: release gate is green; R2 checkpoints=2, recoveredExceptions=2
```

结果满足：真实文件读取通过；正向长时样本通过；缺失、非法、越界和资源/链路反例均被拒绝；回滚检查 7 项、检查点恢复 2 次、异常恢复 2 次。

## 结论

当且仅当上述命令退出码为 `0`，发布前稳定性门通过。任一真实文件读取、资源链路、长时运行、恢复、回滚或反例断言失败，结论为不通过，不得进入发布。

## 回退步骤

1. 停止发布，保留命令输出和失败现场。
2. 回退本次提交：`git revert <T326 提交 SHA>`。
3. 仅在需要恢复工作树且已确认无并行改动时，恢复本次提交涉及的两个白名单目录：`git restore --source=<T326 提交 SHA>^ -- cocos-client/tools/release/stability documentation/release/stability`。
4. 回退后重新执行本文件中的指定验证命令；未重新通过前不得更新共享台账或继续后续发布批次。
