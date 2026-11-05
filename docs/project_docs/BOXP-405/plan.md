# BOXP-405: AI Ops 再設計 段階 1 — 成果指標 `outcome/v2-draft` の集計と export（計画）

設計の正本は Obsidian `Projects/ai-operations-observability/redesign.md`（第 2 章: 定義と式、第 4 章: 暫定 SLO と burn rate、第 6 章: 段階別チェックリスト）。ここには arch 側の実装範囲と検証だけを置く。本 PR は設計レビューの代替ではなく、設計に沿う最小の実装単位である。

## 範囲（arch、段階 1）

1. **`docker/codex-workspace/task-board/ai_ops_outcome.bb`**（新規）
   - 入力: `runs/<ticket>/<run>/summary.edn` の固定 field（`ai_ops_insight.bb` の `load-runs` / `read-summary` を再利用）、`Boards/Task Board.md` のカード行（ticket ID・レーン・assignee。`ai_ops_slo.bb` の `parse-board`）、`Tickets/<id>.md` frontmatter の `assignee` / `status` / `closed`（先頭 40 行の正規表現のみ。本文・タイトルは読まない）。
   - 作業 = run が 1 件以上ある ticket。`start` = 最初の run の `started-at`（無ければ run ID の時刻）。
   - 使える成果 `t_out` = 最初の `status=succeeded` かつ `result ∈ {done, owner-acceptance}` の `finished-at`、または frontmatter `closed`（日精度、`YYYY-MM-DD` を `T00:00:00Z` として扱い `reached_without_run_outcome` に数える。総時間の分位には入れない）のうち早い方。`closed` が run 成果より前の日のときだけ `closed` を採用し、同じ日以降は秒精度の run 成果を使う。読めない run は開始時刻で判定し（run ID の並び順に頼らない）、最初の成果時刻より前（`closed` だけの到達は翌日 0 時より前）に始まったか開始時刻が不明なら `unevaluated`、それ以降に始まったものは到達を覆さずやり直しにだけ数える。`continue` / `review` は成果ではない。
   - 時間予算 168h、窓 7d / 28d（`start ∈ [now−W, now)`）、分類: `reached_in_budget` / `reached_over_budget` / `not_reached` / `excluded_legitimate_wait`（予算超過かつ成果なしで、現在 Blocked かつ最新 Blocked run の `wait-reason ∈ {owner-decision, external-hold, new-scope}`、または Ready かつカード assignee `boxp`）/ `pending` / `unevaluated`（最初の成果より前に読めない run がある、または `start` 不明）。
   - `determined = reached_in_budget + reached_over_budget + not_reached`。最低観測数 7d: 10 / 28d: 20。`status` = `no_observations` (0) / `insufficient` (< min) / `measuring`。
   - 総時間 = run 由来 `t_out − start` の p50 / p90（`ai_ops_insight.bb` の `quantile`）。到達 0 件なら系列を出さない（0 で埋めない）。
   - やり直し = 最初の `t_out` から 14 日経過した到達作業（`matured`）のうち、`t_out` より後に同じ ticket で run が開始されたもの（`rework`）。14 日未満は `pending`。
   - サブコマンド: `snapshot <root> <vault> [--now ISO]`（件数だけの JSON。ticket ID・タイトル・本文は出さない）、`prom <root> <vault>`（Prometheus text）。`--now` はテスト用に現在時刻を固定する。
2. **export の連結**: `ai_ops_ledger.bb` の `refresh-sli-locked!` が v2 の後に `outcome-export-text`（v2 と同じ予算・timeout 方式）を連結し、`ai_ops_outcome_export_ok`（失敗・timeout・空出力・予算超過で 0）を出す。v0/v1/v2 の出力は壊さない。
3. **系列**
   ```
   ai_ops_outcome_info{definition_version="outcome/v2-draft",budget_hours="168",rework_maturity_days="14"} 1
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

## 定義の改訂（`outcome/v2-draft`）

実データの readback で `outcome/v1-draft` の欠陥が 2 件分かったので定義を改めた。

- 判定済みの区分を開始時刻で窓に入れていたため、予算 7 日に対して 7 日窓の失敗が常に 0 件で、`AiOpsOutcomeBurnFast` は発火できなかった。判定が確定した時刻（成果の時刻か、開始 + 予算のうち早い方）で窓に入れる。`pending` / `unevaluated` / `started` は開始時刻のまま。
- burn rate が `reached_over_budget` を失敗に数えず、目標の「予算内の到達率」と合っていなかった。rule 側（lolice）で `(determined - reached_in_budget) / determined / 0.10` にする。

限界: 遅れて到達した作業は、Owner 判断などの正当な待ちがあっても失敗に数える。正当な待ちの除外は現在の状態だけを見るため。

## provider 利用枠の判断支援（AIOPS-QUOTA、`quota/v1-draft`）

成果 SLO の burn rate とは別の入力として、CLI の `rate_limit_event` 由来の数値と enum だけを使う。

- `ai_provider_quota.bb`: 窓ごとの状態（`exhausted` / `near_limit` / `ok` / `expired_unobserved` / `stale` / `unobserved`）と経路の判定（`hold` / `clear` / `unknown`）。共有枠の不足は全 Claude 経路を `hold` にし、代替候補を出さない。モデル専用枠の不足は他の経路を候補として出す。
- 拒否は窓の `status` だけでなく、event 最上位の `status=rejected` と `rateLimitType` からも判定する（該当窓に `status` がない、または窓がない event があるため）。同じ窓により新しい観測があれば窓を優先し、別 account の拒否では止めない。最上位の拒否は記録時に該当窓へ書き込み、次の event で最上位が上書きされても reset まで残す。status のない新しい観測では解除せず、窓の allowed か同じ制限を指す最上位の allowed で解除する。
- runner: 拒否されて reset 前の経路は run を起動しない。カード・担当・claim・budget は変えず、Notes へ 1 回だけ記録する。`unknown` は止めない。読取り失敗は fail open。`CODEX_TASK_BOARD_PROVIDER_QUOTA_HOLD=off` で無効化できる。
- exit≠0 の run で最後の `rate_limit_event` が拒否なら、Blocked の理由に範囲・制限名・reset を記す。category は `agent-process-error` のまま（集計の enum を変えない）。
- 担当の自動変更はしない。候補の提示だけで、変更は Owner または正規 helper が行う。
- 範囲は Claude 経路のみ。Codex 経路の判定は含まない。
- 検証: `tests/ai-observability/test_provider_quota.bb`、runner self-test。

## 実モデル対照評価の前提の修正 (TD-02)

実モデルで評価する前に、評価器の次の点を直す。

- 許可外変更の判定を `git status` から作業ツリーの内容比較へ変える。commit・削除の commit・`.git/info/exclude` で隠した変更を検出する。
- 実モデルの既定コマンドでモデルを固定する。
- 子プロセスへ渡す環境変数を allowlist にする。
- arm B の契約文を評価する経路で組み立てる。
- quota の拒否で停止し、reset 前の再実行を拒否する。停止状態はロックを取った後で読み、先行 run が記録した拒否を見落とさない。
- 中断分を含む累積時間の上限を設ける。
- 同じ出力先への同時実行を拒否する。完了済みの試行を再実行しない。
- run が強制終了されて残ったエージェントと試行を並走させない。ロック (`agent.lock`) と時間の上限はエージェント側のプロセスに持たせ、ロックが残る間の再開は exit 5 で拒否する。
