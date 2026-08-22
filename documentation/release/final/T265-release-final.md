# T265 M8-12 发布前稳定性总门

## 复验命令

```sh
cd cocos-client && node --experimental-strip-types tools/release/final/verify-release-final.mjs
```

总汇验证器按 T326、T327、T328、T329 顺序执行真实子进程，只消费子进程退出码和结构化输出。T265 不读取旧 `BattleA0-performance.json`、T327 pass fixture、manifest、共享台账或 `.ai-dev/results/` 作为证据。

## 实际修改文件

- `cocos-client/tools/release/final/verify-release-final.mjs`
- `documentation/release/final/T265-release-final.md`

未修改前置验证器、共享台账、任务/审批/结果文件或白名单之外的路径。

## 子门判定

| 子门 | 当前真实结果 | T265 判定 |
| --- | --- | --- |
| T326 稳定性 | 子进程退出码 `0`，精确稳定性 rehearsal/conclusion marker 均存在 | PASS |
| T327 性能 | 当前 raw 子进程退出码 `1`；contract 与 pass sample 演练断言完成，正式 GPU gate BLOCKED，并声明 `historical artifact was not consulted` | 演练 PASS；正式性能 BLOCKED |
| T328 安全 | 子进程退出码 `0`，精确 security rehearsal/conclusion marker 均存在 | PASS |
| T329 恢复 | 子进程退出码 `0`，精确 recovery rehearsal/conclusion marker 均存在 | PASS |

当前 T327 BLOCKED 必须同时具备：

- `T327 production contract: PASS`；
- `T327 pass sample:`；
- `T327 formal performance gate: BLOCKED`；
- `historical artifact was not consulted`；
- 不得出现 T327 live GPU PASS、正式 GREEN verifier 或正式 performance GREEN marker。

该状态表示契约演练完成、正式性能被阻断，不表示 T327 子门 GREEN。缺少字段、其他非零退出、伪造成功文本、历史 artifact/fixture 代替 live evidence 或不完整输出均按异常阻断处理。

## 正式 GREEN 条件

只有 T327 子进程退出码为 `0`，且输出同时包含精确的 `T327 production contract: PASS`、正式 GREEN verifier marker，以及以下精确 live marker 时，T327 才可 GREEN：

```text
T327 live GPU gate: PASS (T203 exit code 0; GPU/WebGL2 runtime <non-empty vendor> / <non-empty renderer>; FPS <number>; P95 <number>ms)
```

解析器校验 GPU vendor/renderer 非空、FPS `>=55`、P95 `<=22ms`；不接受 pass sample、旧 artifact、固定文本或宽泛 PASS marker 替代 live GPU 输出。T326、T328、T329 仍要求子进程退出码 `0` 且精确结论 marker 完整存在。脚本内负例覆盖缺少 T327 BLOCKED marker、非零退出上的伪造 live PASS，以及 formal-runtime/历史 artifact 替代 live evidence。

## 当前总门结论

当前指定命令应退出码 `1`，并输出：

```text
T265 T326 stability gate: PASS
T265 T328 security gate: PASS
T265 T329 recovery gate: PASS
T327 rehearsal: PASS (contract completed)
T327 formal performance gate: BLOCKED
T265 final release gate: BLOCKED
```

当前不得发布。只有 T326、T327、T328、T329 四个子门和正式 T327 live GPU/WebGL2/FPS/P95 全部真实 GREEN，T265 才能退出码 `0`。正式性能门槛为 1920x1080 GPU 场景、24 单位压力状态、正式运行时资产、FPS 不低于 `55`、P95 不高于 `22ms`。

## 验收与风险

- T326 保留真实发布契约、1,800 tick/60 battles 长时样本、恢复和缺失/非法/越界反例验收。
- T328 保留真实安全契约、源码边界、存档篡改、缺失/非法/越界和路径穿越反例验收。
- T329 保留真实 `SaveSchema`/`SaveMigration` 的 primary、backup、default、旧版迁移及反例验收。
- 当前唯一总门阻塞为 T327 正式 live GPU 证据未 GREEN；契约演练 PASS 不解除该阻塞。
- T328/T329 客户端验收不替代服务端鉴权、发行平台安全、存储介质和同步链路验收。

## 回退步骤

1. 停止发布，保留总汇验证器、总门报告、四个子验证器输出和失败证据。
2. 合入后由协调器将当前父基线 `8161b9489798b342a4c4e920fb6b763a74b4a110` 替换为实际 T265 merge SHA，执行 `git revert -m 1 <T265 merge SHA>`。
3. 回退后重新执行复验命令；退出码不是 `0` 时不得恢复发布，也不得更新共享台账。
4. 仅在确认没有并行改动、确需恢复工作树时，执行：

   ```sh
   git restore --source=<T265 merge SHA>^ -- cocos-client/tools/release/final documentation/release/final
   ```

5. 性能缺口修复必须重新采集正式设备原始帧时间、GPU/WebGL2、正式运行时资产和压力状态证据，不降低既定 FPS、P95、分辨率、24 单位、六层场景及正式资产门槛。
