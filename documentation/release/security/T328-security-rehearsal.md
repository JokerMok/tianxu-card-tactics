# T328 发布前安全演练记录

## 1. 验证范围

验证器：`cocos-client/tools/release/security/verify-security.mjs`

演练读取以下真实文件：

- `cocos-client/assets/a0-manifest.json`
- `cocos-client/assets/resources/config/manifest.json`
- `cocos-client/assets/resources/config/` 下由真实 manifest 声明的 8 个配置表和 1 个章节索引
- `cocos-client/assets/scripts/config/ConfigLoader.ts`
- `cocos-client/assets/scripts/config/ConfigValidator.ts`
- `cocos-client/assets/scripts/services/SaveSchema.ts`
- `cocos-client/assets/scripts/services/reward/isolation/PveRewardIsolationService.ts`

校验器在内存中加载真实 `ConfigLoader.ts` 的断言函数，读取真实配置资源；同时执行真实 `SaveSchema.ts` 的存档校验、编码和 primary/backup/default 恢复路径。通过样本中的 SHA-256 值用于检测上述真实目标文件是否偏离审查基线。

## 2. 样本与反例

| 类型 | 输入 | 预期结果 |
| --- | --- | --- |
| 通过样本 | `tools/release/security/samples/pass-release-security.json`、真实清单、真实源码和真实配置资源 | 配置契约通过；6 个目标文件哈希匹配；合法存档可校验、编码，primary 恢复成立 |
| 失败样本 | `tools/release/security/samples/fail-tampered-save.json` | 含 `__proto__` 的未知存档字段被真实 `SaveSchema` 拒绝 |
| 缺失反例 | 不存在的 `samples/does-not-exist.json` | 真实读取返回 `ENOENT` 并被断言为拒绝 |
| 非法反例 | `samples/invalid-json.txt` | JSON 解析失败并被断言为拒绝 |
| 越界反例 | 存档 `resources.gold = Number.MAX_SAFE_INTEGER + 1` | 越过安全整数范围，被真实存档校验拒绝；primary 失败后回退到 backup，再在两者均失败时回退 default |
| 路径反例 | manifest 的 `tables.cards = config/../a0-manifest` | 生产 `ConfigLoader.assertConfigManifest` 和资源路径解析器均拒绝 |

## 3. 复验命令

```sh
cd cocos-client && node --experimental-strip-types tools/release/security/verify-security.mjs
```

退出码为 `0`，且必须同时出现真实契约、通过样本、真实存档恢复、失败样本、缺失/非法/越界/路径反例和结论输出。

## 4. 演练结果

指定命令退出码：`0`

```text
T328 real release security contracts: PASS (manifest tables=8, declared resource files=9, source boundary assertions=16)
T328 pass sample: PASS (SHA-256 baselines=6, evidence=contract-rehearsal-fixture)
  negative PASS: out-of-range save integer
  positive PASS: SaveSchema real validation/recovery (primary=T328-PASS, backup=backup, default=default)
  negative PASS: real tampered save sample
  negative PASS: missing real security sample file
  negative PASS: invalid JSON sample
  negative PASS: config resource path traversal
  negative PASS: resource resolver path traversal
T328 counterexamples: PASS (missing file, invalid JSON, out-of-range integer, tampered save, config path traversal)
T328 conclusion: release security rehearsal PASS; covered release gate is green.
T328 rollback: stop release, preserve output, git revert <T328 commit SHA>, then rerun this command before updating the shared ledger.
```

## 5. 结论

T328 安全演练通过。真实配置清单、声明资源和安全相关源码均被读取并参与断言；合法存档通过，篡改、缺失、非法、越界和路径穿越输入均被拒绝；存档恢复链覆盖 primary、backup 和 default 三条路径。

该结论只覆盖本演练定义的客户端发布门禁，不等同于代码签名、服务端鉴权或完整渗透测试结论。当前遗留风险如下：

- SHA-256 基线与验证器同属本地代码仓库，不能替代独立签名或受保护的信任根。
- `localStorage` 存档具备结构校验和损坏回退，但本演练未证明其能识别“结构合法但被人为篡改”的存档。
- 账号、支付、服务端接口、权限和发行平台安全不在本任务允许修改范围内，需由对应模块和发布流程另行验收。

上述项目属于本任务范围外的安全边界，未发现 T328 改动引入的 P0、P1 或 P2 问题。

## 6. 回退步骤

1. 停止发布，保留验证器输出和失败样本现场。
2. 确认 T328 提交 SHA 后执行：`git revert <T328提交SHA>`。
3. 回退完成后重新执行本文件的复验命令；退出码非 `0` 时不得更新共享台账或继续发布。
4. 仅在复验重新通过并完成协调器复核后，恢复发布流程。
