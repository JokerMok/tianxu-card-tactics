# T327 发布前性能演练记录

## 1. 验收范围

本任务只验证发布性能门禁、证据顺序和失败样本处理，不修改正式运行时资产、`test-artifacts`、T203/T265、共享台账或结果文件。

正式门禁为 1920×1080 Web Desktop、GPU 渲染、24 个单位、6 层场景、7 类战斗效果和 7 类音频反馈；FPS 不低于 55，P95 帧时间不高于 22ms。

T327 必须先执行 T203 production verifier。只有 T203 退出码为 0，且输出包含实际成功行 `T203 GPU runtime: PASS (...)` 和 `T203 measured performance: FPS ...; P95 ...ms PASS` 时，才可进入 T327 正式性能判定。WebGL2、formal-runtime、`previewPoseAssets=0`、`artIntegrationComplete=true`、1920×1080 和性能阈值仍由 T203 verifier/runner 强制校验，T327 不重复解析不存在的成功 marker。

## 2. 实际修改文件

- `cocos-client/tools/release/perf/verify-perf.mjs`
- `documentation/release/perf/T327-performance-rehearsal.md`

保留未修改的契约通过夹具 `cocos-client/tools/release/perf/samples/pass-raw-frame-times.json`、历史 `cocos-client/test-artifacts/BattleA0-performance.json` 和现有负例。历史 artifact 只作可选拒绝样本：缺失、删除、损坏或不再符合旧 headless/preview 结构时记录 `SKIPPED`，不能阻塞 T327。

## 3. 验证顺序

1. 读取并校验 A0 manifest、E104 场景契约、T251 效果/音频契约、生产性能模块和契约通过夹具。
2. 执行现有 T327 缺失、非法、越界和原始样本不足负例，并校验 T203 live GPU 证据缺失、越界和 marker 缺失反例。
3. 执行 `tools/verify-production-performance.mjs`。
4. T203 非零或缺少任一实际成功行时，T327 输出 `T327 formal performance gate: BLOCKED` 并返回非零；在此之前不读取历史 `BattleA0-performance.json`。
5. 只有 T203 live gate 通过后，才检查历史 artifact；该文件仍保持旧 headless/preview 失败样本时，验证器继续断言其被拒绝。

## 4. 样本与门禁结果

| 样本或门禁 | 预期结果 | 说明 |
|---|---:|---|
| 契约通过夹具 | PASS | 120 个原始帧时间；FPS 61.350；P95 16.300ms；`evidenceClass=contract-rehearsal-fixture` |
| 缺失文件、缺失字段、非法 renderer | 拒绝 | 保留原有断言 |
| FPS 54.99、P95 22.01ms、119 个原始样本 | 拒绝 | 不降低阈值和采样要求 |
| T203 GPU runtime 或 measured FPS/P95 成功行缺失、伪造或越界 | 拒绝 | T327 只接受精确成功行，并明确报告 `BLOCKED` |
| T203 WebGL2/formal-runtime/正式资产真实性 | 由 T203 拒绝 | T203 verifier/runner 强制检查，不由 T327 放宽 |
| 历史 `BattleA0-performance.json` | 可选拒绝 | 当前样本为 headless、`preview-pose`、24 单位压力 FPS 26.278、P95 50ms；不作为 live gate |
| 当前正式资产 | BLOCKED | 当前正式资产仍为 `preview-pose`，不能形成 formal-runtime 证据 |

## 5. 复验命令

```sh
cd cocos-client && node --experimental-strip-types tools/release/perf/verify-perf.mjs
cd cocos-client && node --experimental-strip-types tools/verify-production-performance.mjs
git diff --check
```

预期：第一条命令非零，原因是 T203 live verifier 拒绝当前 `preview-pose` 正式资产；第二条命令非零，真实 runner 同样拒绝 `preview-pose`。两条命令均不得报告 GREEN。

## 6. 结论

当前 T327 预期为 `BLOCKED`。契约通过夹具只证明门禁计算和字段校验有效；历史 headless/preview artifact 只证明拒绝逻辑有效。当前正式资产仍为 `preview-pose`，T203 未形成可放行的有头 GPU/WebGL2、formal-runtime、FPS 和 P95 证据，不能解除发布阻塞。

## 7. 回退步骤

1. 若本次 T327 修订造成流水线异常，回退本次 T327 提交，并重新执行 T327 与 T203 复验命令。
2. 若 T203 live runner 不可用、退出码非零、marker 不完整或性能越界，保留发布阻塞；不得使用确定性模型、契约夹具或历史 JSON 解除阻塞。
3. 正式性能修复必须重新采集有头 GPU 原始帧时间和运行时资产证据，不降低 55 FPS、22ms、24 个单位、6 层场景或正式资产门槛。
