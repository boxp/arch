# BOXP-651: tfaction の plan 差分による automerge 停止が後続処理で解除される問題の修復

## 背景（修正前の再現）

- tfaction v2.1.0 の plan action は、Renovate PR（`auto_apps.logins`）で `terraform plan` に差分があると
  `disablePullRequestAutoMerge` を実行し、警告コメント（template `renovate-plan-change`）を投稿する。
- しかし `test.yaml` の `enable-auto-merge` job（`wc-enable-auto-merge.yaml`）は `status-check` の成否だけを見て
  `gh pr merge --auto` を実行するため、同じ run の中で無効化が上書きされていた。
- 実例（PR timeline、GitHub API で確認）:

| PR | tfaction による無効化 | 再有効化 | merge |
|---|---|---|---|
| #15166 | 2026-11-16 07:28:21Z | AutoSquashEnabled（enable job） | 07:29:04Z |
| #15336 | 2026-11-18 06:10:52Z | AutoSquashEnabled（enable job） | 06:11:19Z |
| #15443 | 2026-11-21 03:16:39Z | enable job が unstable で失敗 → 失敗 job の再実行で再有効化 | 04:04:25Z |

- Renovate 自身も PR 作成時に platform automerge を有効化している（各 PR の最初の AutoSquashEnabledEvent）。

## 方針

1. `wc-plan.yaml`: plan step に `id: plan` を付け、target ごとに plan 結果
   `{target, outcome: steps.plan.outcome, detailed_exitcode}` を `if: always()` で記録し、
   run artifact `tfaction-plan-result-<target の / を __ に置換>` として `overwrite: true` で upload する。
   再実行 attempt の結果は同名 artifact を上書きするので、判定は常に最新の plan 結果を見る。
2. `wc-test.yaml`: setup の `targets` を reusable workflow の output として公開する。
3. `test.yaml`: `enable-auto-merge` に `needs: test` を足し、`plan_targets` を渡す。権限は `actions: read`（artifact 取得）と `contents: read`（base branch の判定スクリプト checkout）だけ。
4. `wc-enable-auto-merge.yaml`: `actions/download-artifact` を `run-id` 指定（REST API 経由）で使い、前 attempt の artifact も取得する。
   `.github/scripts/judge-renovate-plan-results.sh` で判定し、
   - 全 target が `success` かつ `detailed_exitcode=0`（または target なし）→ 従来どおり `gh pr merge --auto`
   - 差分あり（2）、plan 失敗、skipped/cancelled、exit code 不明、結果欠落・破損・target 不一致、targets 不明 → **有効化しない**。
     既に有効なら `--disable-auto` で無効化し、job は success のまま warning と step summary を出す（再実行を誘わない）。
5. 判定スクリプトは `pull_request_target` の既定 ref（base branch）から sparse checkout するので、PR 側のコードは実行しない。

## 対象外（チケットの制約）

- Terraform `lifecycle.ignore_changes` などで差分を隠す変更（video-rotator の恒常差分は残る）
- 他の hold 解除、無関係な本番変更、新しい課金・権限
- 検証目的での実インフラ変更や、差分ありPRの自動 merge/apply の誘発

## 検証

- `.github/scripts/test-judge-renovate-plan-results.sh`: 差分なし（1/2 target）・target なし → enable、
  差分あり・一部差分あり・plan 失敗・exit code 欠落・skipped・cancelled・結果欠落・未 download・破損・target 不一致・
  targets 空/不正 → block、再実行順序（失敗→差分あり=block、失敗→差分なし=enable）の 17 ケース。
- `actionlint` / `ghalint run` / `shellcheck`。
- 実経路: `pull_request_target` は base branch の workflow を使うので、本 PR 自体の CI は旧 workflow で動く。
  merge 後、自然に来る Renovate PR で確認する:
  - 差分なし target の Renovate PR → 従来どおり automerge されること（通常経路を壊していない）
  - video-rotator など恒常差分のある target の Renovate PR → enable job が有効化せず、PR が open のまま残ること
  検証のために差分ありの PR を作ったり merge/apply を誘発したりはしない。

## 影響

- video-rotator（`terraform/cloudflare/b0xp.io/video-rotator`）を含む aqua-registry 等の Renovate PR は、恒常差分のため今後は
  自動 merge されず、Owner の確認・手動 merge が必要になる（安全側の意図した動作）。

## 未確認範囲

- Renovate が PR 作成後の更新（rebase 等）で platform automerge を再度有効化し、かつ新しい CI run が起きない経路。
  rebase は新しい commit なので CI が再実行され、本修正の判定で再び無効化される想定だが、実観測はしていない。
- `actions/download-artifact` の `run-id` 指定で前 attempt の artifact が取得できることは実運用で確認する（取得できない場合も block 側に倒れる）。
