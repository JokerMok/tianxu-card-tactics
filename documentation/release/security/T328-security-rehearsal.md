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
T328 rollback: stop release, save the current verifier/report/samples, run git log --format=%H --reverse -- <T328 allowed paths>, revert each emitted commit in reverse order with git revert --no-edit, rerun the verifier from the saved copy, record its exit code, and update no shared ledger until it passes.
```

## 5. 结论

T328 安全演练通过。真实配置清单、声明资源和安全相关源码均被读取并参与断言；合法存档通过，篡改、缺失、非法、越界和路径穿越输入均被拒绝；存档恢复链覆盖 primary、backup 和 default 三条路径。

该结论只覆盖本演练定义的客户端发布门禁，不等同于代码签名、服务端鉴权或完整渗透测试结论。当前遗留风险如下：

- SHA-256 基线与验证器同属本地代码仓库，不能替代独立签名或受保护的信任根。
- `localStorage` 存档具备结构校验和损坏回退，但本演练未证明其能识别“结构合法但被人为篡改”的存档。
- 账号、支付、服务端接口、权限和发行平台安全不在本任务允许修改范围内，需由对应模块和发布流程另行验收。

上述项目属于本任务范围外的安全边界，未发现 T328 改动引入的 P0、P1 或 P2 问题。

## 6. 回退步骤

1. 停止发布。回退前从当前状态建立保存副本，并确认验证器、报告和全部样本均存在。输出写入副本之外；不得修改共享台账或结果文件：

   ```sh
   set -eu
   test -z "$(git status --short -- cocos-client/tools/release/security documentation/release/security)"
   rollback_root="$(mktemp -d)"
   saved_copy="$rollback_root/saved-current"
   rollback_copy="$rollback_root/rollback"
   rollback_evidence="$rollback_root/evidence"
   mkdir "$rollback_evidence"
   git worktree add --detach "$saved_copy" HEAD
   git worktree add --detach "$rollback_copy" HEAD
   for relative_path in \
     cocos-client/tools/release/security/verify-security.mjs \
     documentation/release/security/T328-security-rehearsal.md \
     cocos-client/tools/release/security/samples/pass-release-security.json \
     cocos-client/tools/release/security/samples/fail-tampered-save.json \
     cocos-client/tools/release/security/samples/invalid-json.txt; do
     test -s "$saved_copy/$relative_path"
   done
   test "$(git -C "$saved_copy" rev-parse HEAD)" = "$(git -C "$rollback_copy" rev-parse HEAD)"
   ```

2. 在 `rollback_copy` 中动态计算所有触碰 T328 允许路径的提交，再按输出逆序逐个回退。`set -e` 会在任一步失败或产生冲突时立即停止；不得手工补充或删减提交：

   ```sh
   set -eu
   allowed_paths=(
     cocos-client/tools/release/security/
     documentation/release/security/
   )
   commit_log="$rollback_evidence/T328-allowed-path-commits.oldest-first"
   reverse_commit_log="$rollback_evidence/T328-allowed-path-commits.newest-first"
   git -C "$rollback_copy" log --format=%H --reverse -- "${allowed_paths[@]}" > "$commit_log"
   awk '{ sha[NR] = $0 } END { for (i = NR; i >= 1; i--) print sha[i] }' \
     "$commit_log" > "$reverse_commit_log"
   test -s "$reverse_commit_log"
   while IFS= read -r commit_sha; do
     test -n "$commit_sha"
     git -C "$rollback_copy" revert --no-edit "$commit_sha"
     test -z "$(git -C "$rollback_copy" status --short)"
   done < "$reverse_commit_log"
   test ! -e "$rollback_copy/cocos-client/tools/release/security/verify-security.mjs"
   test -z "$(git -C "$rollback_copy" status --short)"
   ```

3. 回退完成后，从步骤 1 保存的副本运行验证器，将输出和退出码保存到副本之外：

   ```sh
   verify_status=0
   (
     cd "$saved_copy/cocos-client" &&
     node --experimental-strip-types tools/release/security/verify-security.mjs
   ) > "$rollback_evidence/T328-saved-copy-verify.log" 2>&1 || verify_status=$?
   printf 'T328 saved-copy verifier exit code: %s\n' "$verify_status" \
     | tee "$rollback_evidence/T328-saved-copy-verify.exit"
   cat "$rollback_evidence/T328-saved-copy-verify.log"
   test "$verify_status" -eq 0
   ```

   退出码非 `0` 时不得更新共享台账或继续发布。
4. 仅在复验重新通过并完成协调器复核后恢复发布流程。完成留证后清理两个临时 worktree：

   ```sh
   git worktree remove "$rollback_copy"
   git worktree remove "$saved_copy"
   ```

## 7. 第五次修复回退演练记录

演练基线为本次修复前的当前 HEAD。隔离 worktree 实测结果：

- 保存副本包含验证器、报告及通过/失败/非法 JSON 三份样本：通过。
- `git log --format=%H --reverse -- <T328 allowed paths>`：动态发现全部触碰允许路径的提交。
- 按动态输出逆序逐个执行 `git revert --no-edit`：每步退出码 `0`，无冲突，步骤完成后 worktree 干净。
- 保存副本中的 `verify-security.mjs`：退出码 `0`。
- 全部动态回退完成后的 rollback worktree：干净。
- 本次独立实测使用的 `saved-current` 与 `rollback` 临时 worktree：完成留证后已清理。
