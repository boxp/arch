# BOXP-402: AI Ops Quality を現行運用（Review 廃止後）に合わせる — 計画

設計の正本は Obsidian `Projects/ai-operations-observability/dashboard-refresh-technical.md`（対応表・画面構成）と `dashboard-refresh-owner-summary.md`（Owner 向け）。ここには arch 側の実装範囲と検証だけを置く。

## 範囲（arch）

1. **停止理由の記録（runner）**: agent が `TASK_BOARD_RESULT: blocked` で終わるとき、最終出力の 1 行
   `TASK_BOARD_WAIT_REASON: owner-decision | external-hold | new-scope | agent-recoverable`
   を allowlist で検証し、`summary.edn` に `:wait-reason` として保存する。無い/語彙外は nil（未記録。unknown として集計）。本文は保存しない。
   agent prompt の blocked 説明にこの 1 行を追加する。
2. **slo-draft/v2 の export**: `scripts/ai-observability/slo_snapshot.bb` の集計を `docker/codex-workspace/task-board/ai_ops_slo.bb` へ移し、`prom <root> <vault>` で `ai_ops_v2_*` gauge を出す。`slo_snapshot.bb` は薄い wrapper として残し、`tests/ai-observability/test_slo_snapshot.bb` を維持する。
   `ai_ops_ledger.bb` の `refresh-sli-locked!` が v1 と同じ予算方式で v2 出力を `sli.prom` に連結し、`ai_ops_v2_export_ok` を出す（失敗時 0、v0/v1 の出力は壊さない）。
   `ai_ops_insight.bb` の `read-summary` は `:wait-reason`（enum のみ）を通す。`blocked-stops` は wait_reason 別に数え、未記録は `unrecorded`。
   現在状態 `ai_ops_v2_board_tasks{state}`: Board のレーンと ticket frontmatter、最新 run の summary から
   running（In Progress）/ ready_not_started（Ready、担当が agent で起動可）/ ready_assignee_mismatch（Ready、カードと票の担当不一致）/ waiting_owner_acceptance（最新 run が owner-acceptance）/ blocked_<wait_reason> / blocked_unrecorded / backlog / done。
3. **テスト**: runner（marker の有無・語彙外・blocked 以外では保存しない）、slo（continue 停止/救援/Blocked 理由/現在状態/空分母/移行 ledger 不読/再開不明）、ledger（v2 連結・予算超過・失敗時 export_ok=0）。既存 CI `test-codex-task-board-runner.yml` に乗せる。

## 範囲外

SLO 数値の正式承認、新 alert、Langfuse、routing 変更、本文収集、既存 cron/alert の変更。sli/v1・v0 の既存系列の定義変更（移行 Done の混入は v2 の `ai_ops_v2_migration` で件数を併記し、過去の値は変えない）。

## 配備の注意

arch main への merge は `build-codex-workspace-image.yml` → argocd-image-updater により **codex-workspace Pod の自動再起動**を伴う。再起動の要否・時期は Owner 確認を 1 回とる（BOXP-402 Notes）。ダッシュボード（lolice）は再起動なしで反映できるので先に配備する。
