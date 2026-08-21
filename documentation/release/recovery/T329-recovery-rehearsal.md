# T329 M8-12-RECOVERY 发布前恢复演练

## 1. 验收范围

验证器：`cocos-client/tools/release/recovery/verify-recovery.mjs`

本演练只验证客户端存档恢复和旧版存档迁移。验证器直接读取并导入以下真实生产文件：

- `cocos-client/assets/scripts/services/SaveSchema.ts`
- `cocos-client/assets/scripts/services/SaveMigration.ts`

验证器拒绝符号链接和非普通文件，并对真实源码中的校验、primary/backup/default 恢复、版本越界和迁移分支做断言。通过样本只提供输入和基线哈希，不替代真实实现。

## 2. 本次提交实际修改文件

- `cocos-client/tools/release/recovery/verify-recovery.mjs`
- `cocos-client/tools/release/recovery/samples/pass-release-recovery.json`
- `cocos-client/tools/release/recovery/samples/fail-unrecoverable-save.json`
- `cocos-client/tools/release/recovery/samples/invalid-json.txt`
- `documentation/release/recovery/T329-recovery-rehearsal.md`

未修改共享台账、结果文件或允许目录之外的路径。

## 3. 样本与反例

| 类型 | 输入 | 结果 |
| --- | --- | --- |
| 通过样本 | `pass-release-recovery.json`；合法 primary 和 backup | 真实 `SaveSchema` 分别走 primary、backup；缺失 PVE 分片按 v1 规则在内存迁移 |
| 失败样本 | `fail-unrecoverable-save.json`；primary 为非法字符串，backup 为不支持版本 | 两者均被真实校验拒绝，恢复结果为 default，保留两条错误信息 |
| 旧版迁移 | 通过样本中的旧版 backup | 真实 `SaveMigration` 从损坏 primary 切换到 backup，迁移为当前 schema；两者损坏时回到 default |
| 缺失反例 | 不存在的 `does-not-exist.json` | 真实文件读取返回 `ENOENT`，被断言为拒绝 |
| 非法 JSON | `samples/invalid-json.txt` | JSON 解析失败，被断言为拒绝 |
| 非法字段/版本 | 增加未知字段；将 `schemaVersion` 改为 `99` | 被真实 `validateSave` 拒绝 |
| 越界反例 | `updatedAt = Number.MAX_SAFE_INTEGER + 1` | 被真实 `validateSave` 拒绝 |
| 负值反例 | `resources.gold = -1` | 被真实 `validateSave` 拒绝 |

## 4. 复验命令与输出

```sh
cd cocos-client && node --experimental-strip-types tools/release/recovery/verify-recovery.mjs
```

退出码：`0`

```text
T329 SaveSchema recovery: PASS (primary=primary, backup=backup, corrupt primary+backup=default)
T329 SaveMigration recovery: PASS (corrupt primary -> backup, corrupt primary+backup -> default)
  negative PASS: missing recovery sample file
  negative PASS: invalid JSON recovery sample
  negative PASS: unknown save field
  negative PASS: unsupported save schema version
  negative PASS: out-of-range save timestamp
  negative PASS: negative resource balance
T329 counterexamples: PASS (missing file, invalid JSON, unknown field, unsupported version, timestamp/resource bounds)
T329 source reads: PASS (SaveSchema bytes=4700, SaveMigration bytes=2880, assertions=9)
T329 conclusion: release recovery rehearsal PASS; primary, backup, default and legacy migration paths are verified by real production code.
T329 rollback: stop release, preserve output, git revert <T329 commit SHA>, then rerun this command before updating the shared ledger.
```

## 5. 结论

T329 恢复演练通过。当前覆盖范围内，合法存档可保留 primary；primary 损坏时使用 backup；primary 与 backup 均不可用时生成 default；旧版存档可从 backup 迁移到当前 schema。缺失、非法和越界输入均未被当作有效存档接受。

该结论只覆盖客户端 `SaveSchema`、`SaveMigration` 及本记录列出的恢复门禁，不等同于浏览器存储介质、发行平台同步、账号服务端或完整发布流程的验收。源码哈希与验证器均在同一仓库，不能替代受保护的签名信任根。

## 6. 回退步骤

1. 停止发布，保留验证器完整输出和失败样本现场。
2. 确认本次 T329 提交 SHA，执行：`git revert <T329 提交 SHA>`。
3. 回退后重新执行本文件中的复验命令；退出码不是 `0` 时，不得继续发布，也不得更新共享台账。
4. 仅在复验重新通过并完成协调器复核后恢复发布流程。
