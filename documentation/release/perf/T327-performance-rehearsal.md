# T327 发布前性能演练记录

## 1. 验收范围

本演练验证发布性能门禁及反例处理，不修改正式运行时资产、共享台账或结果文件。

正式门禁：1920×1080 Web Desktop、GPU 渲染、24 个单位、6 层场景、7 类战斗效果及 7 类音频反馈；FPS 不低于 55，P95 帧时间不高于 22ms。

验证器读取并校验以下真实文件：

- `cocos-client/assets/a0-manifest.json`
- `cocos-client/assets/scripts/battle/performance/production-performance.ts`
- `cocos-client/assets/resources/art/battle/scenes/E104/scene-contract.json`
- `cocos-client/assets/resources/art/battle/effects/battle-effects-audio-contract.json`
- `cocos-client/test-artifacts/BattleA0-performance.json`

## 2. 复验命令

```sh
cd cocos-client && node --experimental-strip-types tools/release/perf/verify-perf.mjs
```

退出码为 `0` 表示验证器自身、正式契约、通过样本和预期失败反例均按要求完成断言；不表示当前真实运行时性能已经放行。

## 3. 样本与结果

| 样本 | 输入 | 结果 | 结论 |
|---|---|---|---|
| 通过样本 `tools/release/perf/samples/pass-raw-frame-times.json` | 120 个原始帧时间，16.3ms/帧 | FPS 61.350，P95 16.300ms | 通过算术门禁 |
| 真实失败样本 `test-artifacts/BattleA0-performance.json` | 1920×1080；24 单位；headless；preview-pose；stress FPS 26.277，P95 50ms | 拒绝 | 不得作为发布证据 |
| 缺失文件 | `samples/does-not-exist.json` | 拒绝 | 文件读取失败被断言 |
| 缺失字段 | 删除 manifest 的 `maximumP95FrameTimeMs` | 拒绝 | 正式阈值完整性被断言 |
| 非法值 | `renderer=software` | 拒绝 | GPU 渲染约束被断言 |
| 越界值 | FPS 54.99；P95 22.01ms | 拒绝 | 两条性能阈值分别被断言 |
| 原始样本不足 | 仅 119 个帧时间 | 拒绝 | 采样数量被断言 |

## 4. 结论

T327 验证器复验通过，正式配置与反例门禁有效。

当前发布性能结论为：**不放行**。真实 `BattleA0-performance.json` 为 headless、preview-pose，且压力样本低于 FPS 门槛并超过 P95 门槛；通过样本属于契约演练夹具，不替代有头硬件加速 GPU 运行证据。当前证据还未覆盖战斗 Draw Call、纹理显存、首个 Bundle 压缩体积和缓存场景切换时长，不能据此签署完整发布性能。

## 5. 回退步骤

1. 若 T327 验证器变更造成发布流水线异常，回退本次提交：`git revert <T327提交SHA>`，再执行本记录中的复验命令。
2. 若真实 GPU 复验仍不达标，保留当前发布候选不放行；按既定顺序减少透明覆盖、骨骼数量、图集尺寸、序列帧数量和粒子数量，每次改动后重新采集原始帧时间及 GPU 证据。
3. 回退优化时恢复最近一次通过的正式资产版本，不降低 55 FPS、22ms、24 单位、6 层场景或正式资产门槛，也不以 headless、相对性能或 preview-pose 样本替代硬件运行结果。
