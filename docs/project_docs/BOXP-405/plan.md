# BOXP-405: AI Ops 再設計 段階 1 — 成果指標 `outcome/v1-draft` の集計と export（計画）

設計の正本は Obsidian `Projects/ai-operations-observability/redesign.md`（第 2 章: 定義と式、第 4 章: 暫定 SLO と burn rate、第 6 章: 段階別チェックリスト）。ここには arch 側の実装範囲と検証だけを置く。本 PR は設計レビューの代替ではなく、設計に沿う最小の実装単位である。

## 範囲（arch、段階 1）

1. **`docker/codex-workspace/task-board/ai_ops_outcome.bb`**（新規）
   - 入力: `runs/<ticket>/<run>/summary.edn` の固定 field（`ai_ops_insight.bb` の `load-runs` / `read-summary` を再利用）、`Boards/Task Board.md` のカード行（ticket ID・レーン・assignee。`ai_ops_slo.bb` の `parse-board`）、`Tickets/<id>.md` frontmatter の `assignee` / `status` / `closed`（先頭 40 行の正規表現のみ。本文・タイトルは読まない）。
   - 作業 = run が 1 件以上ある ticket。`start` = 最初の run の `started-at`（無ければ run ID の時刻）。
   - 使える成果 `t_out` = 最初の `status=succeeded` かつ `result ∈ {done, owner-acceptance}` の `finished-at`、または frontmatter `closed`（日精度、`YYYY-MM-DD` を `T00:00:00Z` として扱い `reached_without_run_outcome` に数える。総時間の分位には入れない）。`continue` / `review` は成果ではない。
   - 時間予算 168h、窓 7d / 28d（`start ∈ [now−W, now)`）、分類: `reached_in_budget` / `reached_over_budget` / `not_reached` / `excluded_legitimate_wait`（予算超過かつ成果なしで、現在 Blocked かつ最新 Blocked run の `wait-reason ∈ {owner-decision, external-hold, new-scope}`、または Ready かつカード assignee `boxp`）/ `pending` / `unevaluated`（最初の成果より前に読めない run がある、または `start` 不明）。
   - `determined = reached_in_budget + reached_over_budget + not_reached`。最低観測数 7d: 10 / 28d: 20。`status` = `no_observations` (0) / `insufficient` (< min) / `measuring`。
   - 総時間 = run 由来 `t_out − start` の p50 / p90（`ai_ops_insight.bb` の `quantile`）。到達 0 件なら系列を出さない（0 で埋めない）。
   - やり直し = 最初の `t_out` から 14 日経過した到達作業（`matured`）のうち、`t_out` より後に同じ ticket で run が開始されたもの（`rework`）。14 日未満は `pending`。
   - サブコマンド: `snapshot <root> <vault> [--now ISO]`（件数だけの JSON。ticket ID・タイトル・本文は出さない）、`prom <root> <vault>`（Prometheus text）。`--now` はテスト用に現在時刻を固定する。
2. **export の連結**: `ai_ops_ledger.bb` の `refresh-sli-locked!` が v2 の後に `outcome-export-text`（v2 と同じ予算・timeout 方式）を連結し、`ai_ops_outcome_export_ok`（失敗・timeout・空出力・予算超過で 0）を出す。v0/v1/v2 の出力は壊さない。
3. **系列**
   ```
   ai_ops_outcome_info{definition_version="outcome/v1-draft",budget_hours="168",rework_maturity_days="14"} 1
   ai_ops_outcome_generated_timestamp_seconds
   ai_ops_outcome_tasks{window="7d|28d",part="started|determined|reached_in_budget|reached_over_budget|not_reached|pending|excluded_legitimate_wait|unevaluated"}
   ai_ops_outcome_reach_status{window,status="no_observations|insufficient|measuring"} 1   （該当 status だけ 1、他は 0 を出す）
   ai_ops_outcome_min_observations{window}
   ai_ops_outcome_hours{window,quantile="0.5|0.9"}
   ai_ops_outcome_duration_tasks{window,part="measured|reached_without_run_outcome"}
   ai_ops_outcome_rework{window,part="matured|rework|pending"}
   ai_ops_outcome_export_ok
   ```
4. **テスト**: `tests/ai-observability/test_outcome.bb`（合成 fixture、本文なし。`SECRET` 文字列・ticket ID が出力に無いこと）、`tests/codex-workspace/ai-ops-ledger-test.sh` に連結・失敗時 `export_ok 0`・予算超過の case。CI `test-codex-task-board-runner.yml` の remaining suite と `tests/codex-workspace/ci-partition-test.py` の suite inventory に追加。

## 範囲外（段階 2 以降・別判断）

Prometheus alert rule と Grafana 最上段（lolice）、runner の prompt への「AI Ops 判断支援」節、固定課題の対照評価、SLO 正式値の承認、Alertmanager の受信先変更、本文収集、既存 cron/alert の変更。

## 配備の注意

arch main への merge は `build-codex-workspace-image.yml` → argocd-image-updater で **codex-workspace Pod の自動再起動**を伴う。再起動の時期は Owner 確認を 1 回とる（BOXP-402 の承認は再利用しない）。lolice 側の rule / dashboard は再起動なしで反映できる。

## 検証

```sh
bb tests/ai-observability/test_outcome.bb
tests/codex-workspace/ai-ops-ledger-test.sh
python3 tests/codex-workspace/ci-partition-test.py
bb docker/codex-workspace/task-board/ai_ops_outcome.bb snapshot "$CODEX_TASK_BOARD_ROOT" "$CODEX_TASK_BOARD_VAULT"   # 実データ read-only、件数のみ
```
