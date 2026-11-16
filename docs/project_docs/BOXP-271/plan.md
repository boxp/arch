# BOXP-271: Task Board runner が merge 済み PR URL を mergeability 失敗と誤判定する問題の修正

## 背景

`review-gate!` は agent の最終メッセージから GitHub PR URL を全件抽出し、`wait-for-pr-state!` で
mergeability / CI / codex review を順に gate する。merge 済み PR に対して GitHub は
`mergeStateStatus=UNKNOWN` を返すため `merge-state` が `:pending` と判定し、
`CODEX_TASK_BOARD_PR_GATE_TIMEOUT_SECONDS`（既定 1800 秒）まで poll した末に
`gate=mergeability` の retryable 失敗になっていた（BOXP-270 run 20261022T115703Z で再現）。

`pr-view` が `state` を取得していないため merged を判別できなかったことが根本原因。

## 方針

1. `pr-view` の `--json` に `state,mergedAt` を追加する。
2. `wait-for-pr-state!` の poll ループ先頭で `state=MERGED` を検出したら、
   timeout を待たず `{:ok? true :merged? true}` を返す（poll 中に merge された場合も即時 pass）。
3. `review-gate!` は `:merged?` の PR について `run-codex-review!` を実行せず passed 扱いにする。
   diff は既に base に取り込まれているため再レビュー対象ではない。
   gate 結果に `:merged-pr-urls`（URL のみ）を追加して summary.edn に永続化し、
   ticket Notes には `persisted-review-gate-reason` 経由で
   「Already-merged PR(s) skipped gates and codex review: <urls>.」を残す
   （gh / agent 由来の生テキストは既存方針どおり Notes / summary に書かない）。
4. `TASK_BOARD_REVIEW_PR: none` と PR URL が併記された場合に URL を優先する既存決定
   （BOXP-42 `test_review_with_pr_and_none_marker_checks_pr`）は維持する。
   none + merged URL のみのケースは方針 2/3 により自然に review へ遷移する。
5. `TASK_BOARD_REVIEW_PR: <url>` による明示指定はスコープ外。

## テスト

fake `gh` に `GH_FAKE_PR_STATE` / `GH_FAKE_PR_STATE_<N>` を追加し、`MERGED` のとき
`state=MERGED`, `mergedAt` 付き, `mergeStateStatus=UNKNOWN` を返す（実機の応答に合わせる）。

- `test_review_with_merged_pr_skips_gates`: merged PR のみ → timeout を待たず review へ。
  Notes / summary.edn に merged skip の記載、codex review が呼ばれないこと。
- `test_review_with_none_marker_and_merged_pr_moves_review`: BOXP-270 再現ケース
  （none marker + merged PR URL 2 件）→ review へ。
- `test_review_with_open_and_merged_prs_gates_open_only`: open PR と merged PR の混在 →
  open PR のみ gate / codex review され review へ。
- 既存 `test_review_with_behind_merge_state_times_out`（BEHIND は引き続き timeout）、
  `test_review_with_pr_and_none_marker_checks_pr` が pass すること。

## 配備

runner image は main への push で `ghcr.io/boxp/arch/codex-workspace:sha-<short>` としてビルドされ、
lolice の ArgoCD Image Updater が Deployment を更新して Pod が再作成される。
BOXP-252 の graceful shutdown により in-flight run は checkpoint 後に retry されるが、
merge は Task Board の In Progress レーンに長時間 run がないタイミングを選ぶ。

配備後、merged PR 参照のみの最終メッセージを返す実 run の `summary.edn` `:review-gate` に
`:merged-pr-urls` が記録され review へ遷移することを確認し、本票 Notes に記録する。
