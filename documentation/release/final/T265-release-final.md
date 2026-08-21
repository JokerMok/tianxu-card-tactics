# T265 M8-12 发布前稳定性总门

## 复验命令

```sh
cd cocos-client && node --experimental-strip-types tools/release/final/verify-release-final.mjs
```

总汇验证器真实顺序执行 T326、T327、T328、T329 四个子验证器，记录子命令退出码和输出；不读取共享台账或 `.ai-dev/results/` 作为放行依据。

## 实际修改文件

- `cocos-client/tools/release/final/verify-release-final.mjs`
- `documentation/release/final/T265-release-final.md`

未修改前置验证器、共享台账、结果文件或白名单之外的路径。

## 子门结果

| 子门 | 真实命令结果 | 总汇判定 | 依据 |
| --- | ---: | --- | --- |
| T326 稳定性 | 退出码 `0` | PASS | 真实发布契约、1,800 tick/60 battles 长时样本、回滚/恢复和缺失/非法/越界反例均通过 |
| T327 性能演练 | 退出码 `0` | 演练 PASS；正式性能 BLOCKED | verifier PASS 仅表示演练断言完成；真实运行产物仍为 headless/preview，且绝对性能未达标 |
| T328 安全 | 退出码 `0` | PASS | 真实配置/源码/存档恢复和篡改、缺失、非法、越界、路径穿越反例通过 |
| T329 恢复 | 退出码 `0` | PASS | 真实 `SaveSchema`/`SaveMigration` 的 primary、backup、default、旧版迁移和反例通过 |

关键真实输出：

```text
T265 T326 stability gate: PASS
T265 T328 security gate: PASS
T265 T329 recovery gate: PASS
T327 verifier result: PASS (rehearsal assertions completed)
T327 formal performance gate: BLOCKED
T327 formal evidence: artifact headless=true; artMode=preview-pose; previewPoseAssets=2; artIntegrationComplete=false; absolutePerformancePass=false; stress FPS=26.278; stress P95=50.000ms; thresholds FPS>=55, P95<=22ms; pass sample evidenceClass=contract-rehearsal-fixture
```

T327 通过样本明确标记为 `contract-rehearsal-fixture`，不得替代正式设备证据。真实 `BattleA0-performance.json` 同时满足以下阻塞条件：

- `headless=true`，不是正式有头设备运行；
- `artMode=preview-pose`、`previewPoseAssets=2`、`artIntegrationComplete=false`，不是正式运行时资产；
- `absolutePerformancePass=false`；
- 压力 FPS `26.278 < 55`；
- 压力 P95 帧时间 `50ms > 22ms`。

## 总门结论

指定命令实际退出码：`1`。

```text
T265 final release gate: BLOCKED
```

当前不得发布。只有补齐正式有头 GPU 运行时产物，且使用正式运行时资产、24 单位压力状态、FPS 不低于 55、P95 不高于 22ms，并重新通过 T327 真实验证器和本总门，才可解除阻塞。不得把 T327 verifier PASS、headless/preview 夹具或相对性能结果改写为正式性能放行。

## 独立审查

- `node --check cocos-client/tools/release/final/verify-release-final.mjs`：退出码 `0`。
- `node --experimental-strip-types --check cocos-client/tools/release/final/verify-release-final.mjs`：退出码 `0`。
- 总汇脚本只调用固定的四个真实子验证器；子验证器非零、缺失真实结论输出或性能证据缺失时均不能形成 GREEN。
- T327 的正式性能判定独立读取真实运行产物；夹具证据和 verifier PASS 不会短路 `headless`、正式资产、FPS、P95 或 `absolutePerformancePass` 断言。
- 本次允许路径变更未发现 P0、P1、P2 问题；唯一发布阻塞为 T327 真实性能证据缺口。

## 风险

- 发布性能证据缺口未关闭；当前性能数据不能证明正式设备性能。
- T328 的客户端安全演练和 T329 的客户端存档恢复演练仅覆盖各自报告范围，不替代服务端鉴权、发行平台安全、存储介质和同步链路验收。
- 本次总汇验证器退出码为 `1` 是预期的安全阻断，不是测试绕过或验证器故障。

## 回退步骤

1. 停止发布，保留总汇验证器、总门报告、四个子验证器输出和性能失败产物。
2. 确认本次 T265 提交 SHA，执行 `git revert <T265 commit SHA>`。
3. 回退后重新执行上述复验命令；退出码不是 `0` 时不得恢复发布，也不得更新共享台账。
4. 仅在确认没有并行改动、确需恢复工作树时，执行：

   ```sh
   git restore --source=<T265 commit SHA>^ -- cocos-client/tools/release/final documentation/release/final
   ```

5. 性能缺口修复必须重新采集正式设备原始帧时间和运行时资产证据，不降低既定 FPS、P95、分辨率、24 单位、六层场景及正式资产门槛。
