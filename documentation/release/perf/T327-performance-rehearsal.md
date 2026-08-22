# T327 发布前性能演练记录

## 1. 验收范围

本任务只验证发布性能门禁、证据顺序和失败样本处理，不修改正式运行时资产、`test-artifacts`、T203/T265、共享台账或结果文件。

正式门禁为 1920×1080 Web Desktop、GPU 渲染、24 个单位、6 层场景、7 类战斗效果和 7 类音频反馈；FPS 不低于 55，P95 帧时间不高于 22ms。

本记录区分两种结果：

- **验证器契约/反例检查完成**：生产配置、契约通过夹具和缺失/非法/越界反例均完成断言。此处的 `PASS` 只表示检查逻辑完成，不表示正式性能门放行。
- **正式性能门放行**：T203 live GPU gate 退出码为 `0`，并提供真实的 WebGL2、`formal-runtime`、`previewPoseAssets=0`、`artIntegrationComplete=true`、1920×1080 及性能阈值证据。只有这组 live formal-runtime GPU evidence 全部通过，T327 原始命令才允许以 `0` 退出并呈现绿色结果。

T327 必须先执行 T203 production verifier。T203 退出码非零、缺少任一实际成功行，或正式资产仍为 `preview-pose` 时，原始命令按 fail-closed 设计输出 `T327 formal performance gate: BLOCKED` 并返回非零；这是预期的发布阻断，不是验证器自身故障，也不等同于契约夹具通过。T203 verifier/runner 强制校验上述正式证据，T327 不把确定性模型、契约夹具或历史 headless/preview artifact 升级为正式证据。

## 2. 本次文档修复实际修改文件

- `documentation/release/perf/T327-performance-rehearsal.md`

本次只修正文档语义；`cocos-client/tools/release/perf/verify-perf.mjs`、契约通过夹具 `cocos-client/tools/release/perf/samples/pass-raw-frame-times.json`、历史 `cocos-client/test-artifacts/BattleA0-performance.json`、`.ai-dev/` 结果和任务文件均未修改。历史 artifact 只作可选拒绝样本：缺失、删除、损坏或不再符合旧 headless/preview 结构时记录 `SKIPPED`，不能阻塞 T327。

## 3. 验证顺序

1. 读取并校验 A0 manifest、E104 场景契约、T251 效果/音频契约、生产性能模块和契约通过夹具。
2. 执行现有 T327 缺失、非法、越界和原始样本不足负例，校验 T203 精确成功行解析，以及结构化 WebGL2/formal-runtime 证据缺失反例。
3. 由 T327 原始命令执行 `tools/verify-production-performance.mjs`，先完成 T203 live GPU gate。
4. T203 非零或缺少任一实际成功行时，T327 输出 `T327 formal performance gate: BLOCKED` 并返回非零；在此之前不读取历史 `BattleA0-performance.json`。
5. 只有 T203 live gate 通过后，才检查历史 artifact；该文件仍保持旧 headless/preview 失败样本时，验证器继续断言其被拒绝。

## 4. 样本与门禁结果

| 样本或门禁 | 预期结果 | 说明 |
|---|---:|---|
| 契约检查通过夹具 | PASS（仅契约） | 120 个原始帧时间；FPS 61.350；P95 16.300ms；`evidenceClass=contract-rehearsal-fixture`；不构成正式性能放行 |
| 缺失文件、缺失字段、非法 renderer | 拒绝 | 保留原有断言 |
| FPS 54.99、P95 22.01ms、119 个原始样本 | 拒绝 | 不降低阈值和采样要求 |
| T203 GPU runtime 或 measured FPS/P95 成功行缺失、伪造或越界 | 拒绝 | T327 只接受精确成功行，并明确报告 `BLOCKED` |
| T203 WebGL2/formal-runtime 结构化证据缺失 | 拒绝 | 负例直接调用 T203 的结构化 evidence validator，不依赖文本搜索 |
| T203 正式资产真实性 | 由 T203 拒绝 | T203 verifier/runner 强制检查，不由 T327 放宽 |
| 历史 `BattleA0-performance.json` | 可选拒绝 | 当前样本为 headless、`preview-pose`、24 单位压力 FPS 26.278、P95 50ms；不作为 live gate |
| 当前正式资产 | BLOCKED | 当前正式资产仍为 `preview-pose`，不能形成 formal-runtime 证据 |

## 5. 复验命令

```sh
set +e
output="$(cd cocos-client && node --experimental-strip-types tools/release/perf/verify-perf.mjs 2>&1)"
exit_code=$?
printf '%s\n' "$output"
if [ "$exit_code" -eq 0 ]; then
  printf '%s\n' 'expected the current preview-pose gate to return non-zero' >&2
  exit 1
fi
if ! printf '%s\n' "$output" | grep -Fq 'T327 formal performance gate: BLOCKED'; then
  printf '%s\n' 'expected explicit T327 formal performance gate: BLOCKED evidence' >&2
  exit 1
fi
git diff --check
```

当前正式资产仍为 `preview-pose` 时，预期 `exit_code` 为非零，且输出必须包含 `T327 formal performance gate: BLOCKED` 或同等明确的 `BLOCKED` 证据；这正是本次复验断言。不要把命令改成断言 `0`，也不要伪造成功行、使用历史 headless/preview artifact 或把 `contract-rehearsal-fixture` / pass fixture 当作正式放行证据。只有真实 T203 live formal-runtime GPU evidence 通过时，原始命令才应返回 `0` 并报告绿色正式性能门。

本 worktree 基线复验已得到退出码 `1`，输出包含 `T327 formal performance gate: BLOCKED`，并报告 `artMode=preview-pose`、`previewPoseAssets=2`、`artIntegrationComplete=false`；该结果符合上述预期。

## 6. 结论

当前 T327 预期为 `BLOCKED`。契约/反例检查完成只证明门禁计算、字段校验和拒绝逻辑有效；历史 headless/preview artifact 只作失败样本。当前正式资产仍为 `preview-pose`，T203 未形成可放行的有头 GPU/WebGL2、formal-runtime、FPS 和 P95 证据，不能解除发布阻塞。正式性能门未放行。

## 7. 未覆盖指标

本门禁未覆盖战斗 Draw Call、纹理显存、首个 Bundle 压缩体积和缓存场景切换时长。这些指标不能由当前契约夹具、历史 artifact 或 T203 当前失败输出推定为通过，需在后续正式性能验收中单独采集和记录。

## 8. 回退步骤

1. 当前修复链可追溯基线/回退父提交为 `9bc03b76ecc14ef49493a40cb2d3d082acc68469`。提交完成后，用 `git log -1 --format=%H -- documentation/release/perf/T327-performance-rehearsal.md` 取得本次独立文档修复提交 SHA，并执行 `git revert <该提交 SHA>`；若文档合入主线，合入后以实际 merge commit 替换该占位。
2. 若 T203 live runner 不可用、退出码非零、marker 不完整或性能越界，保留发布阻塞；不得使用确定性模型、契约夹具或历史 JSON 解除阻塞。
3. 正式性能修复必须重新采集有头 GPU 原始帧时间和运行时资产证据，不降低 55 FPS、22ms、24 个单位、6 层场景或正式资产门槛。
