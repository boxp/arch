# BOXP-651: tfaction の plan 差分による automerge 停止が後続処理で解除される問題の修復

## 背景（修正前の再現）

- tfaction の plan action（v2.1.0 で調査、rebase 後の v2.3.5 でも `detailed_exitcode` 出力と差分時の無効化処理が同じことを確認）は、Renovate PR（`auto_apps.logins`）で `terraform plan` に差分があると
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
   ファイル名 `<slug>.json`（slug = target の / を __ に置換）で run artifact `tfaction-plan-result-<slug>` として `overwrite: true` で upload する。
   再実行 attempt の結果は同名 artifact を上書きするので、判定は常に最新の plan 結果を見る。
2. `wc-test.yaml`: setup の `targets` を reusable workflow の output として公開する。
3. `test.yaml`: `enable-auto-merge` に `needs: test` を足し、`plan_targets` を渡す。権限は `actions: read`（artifact 取得）と `contents: read`（base branch の判定スクリプト checkout）だけ。
4. `wc-enable-auto-merge.yaml`: `actions/download-artifact` を `run-id` 指定（REST API 経由）で使い、前 attempt の artifact も取得する。
   `merge-multiple: true` で常に `<dir>/<slug>.json` に平坦に展開する（一致 artifact が1件だと名前付きサブディレクトリが作られない挙動への対策）。
   job 条件は `! cancelled()` とし、test/status-check が失敗しても実行して `upstream_ok=false` で block → 既存 automerge を無効化する（必須 check は status-check のみなので merge 可否には影響しない）。
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
- `skip:<target>` ラベル等で `skip_terraform=true` になった target は plan が実行されず exit code が出ないため、plan job 内で automerge を無効化し、判定も block（自動 merge しない）になる。Renovate PR に人が skip ラベルを付けた場合は手動 merge が必要。

## 追加修正（codex review P1: skip_terraform の競合）

- `skip_terraform=true` の target では plan が実行されず tfaction は automerge を無効化しない。必須 check の status-check は
  test 成功後すぐ通過（skipped）するため、enable-auto-merge job が無効化する前に Renovate が有効化済みの automerge で merge され得た。
- 対策: `wc-plan.yaml` の plan job 内で、Renovate PR かつ「plan step が success かつ `detailed_exitcode=0`」以外の target について
  `gh pr merge --disable-auto` を実行する。plan job は test → status-check より前に完了するので、必須 check 通過前に無効化される。
  enable-auto-merge job の判定（全 target が差分なしの時だけ有効化）はそのまま残す。

## 追加修正（codex review P1: 判定前 merge の競合）

- Renovate が PR 作成時に automerge を有効化しているため、artifact の download 失敗や結果欠落で enable-auto-merge job が
  block と判定する前に、必須 check の status-check 通過で PR が merge され得た。
- 対策: `test.yaml` に `disable-auto-merge` job を追加し、Renovate PR の run 開始時に automerge を必ず無効化する。
  status-check と enable-auto-merge はこの job を `needs` に持つので、無効化が終わるまで status-check は完了せず、
  無効化に失敗すれば status-check が失敗して merge されない。automerge を再び有効化するのは、全 target が差分なしと
  判定された enable-auto-merge job だけ（「先に止めて、確認できた時だけ有効化」）。
- 通常経路: 差分なしの Renovate PR は enable job で有効化され、必須 check 通過済みなら即 merge される。
