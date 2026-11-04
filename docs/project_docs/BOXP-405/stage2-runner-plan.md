# BOXP-405: AI Ops 再設計 段階 2 — runner の「AI Ops 判断支援」節（計画）

設計の正本は Obsidian `Projects/ai-operations-observability/redesign.md` 第 5 章（エージェントの受領と判断経路）。段階 1（`ai_ops_outcome_*` の export、PR #14461）と lolice 側の rule / 主画面（boxp/lolice#1034）に続く、arch 側の受領経路の最小実装。

## 範囲（arch、段階 2）

1. **読み取り**: `task_board_runner.bb` の `run-agent!` が run 開始時に 1 回だけ、既存の Grafana datasource proxy（`GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN`、read-only）経由で Prometheus の `/api/v1/alerts` を `curl --max-time 5`（`CODEX_TASK_BOARD_AI_OPS_ALERTS_TIMEOUT_SECONDS` で変更可）で読む。token は curl の `--variable %ENV` / `--expand-header` で環境変数から展開し、argv にもディスクにも置かない。
   - opt-in: `CODEX_TASK_BOARD_AI_OPS_ALERTS_DATASOURCE_UID`（Prometheus datasource の uid）が無ければ何もしない（節も summary の項目も出ない）。
   - allowlist: `AiOpsOutcomeBurnFast` / `AiOpsOutcomeBurnSlow` / `AiOpsOutcomeMeasurementStale` / `AiOpsHarnessEvalRegression` だけを採用し、alertname / state / severity / window / definition_version の label だけ残す。annotation・value・他のアラートは捨てる。
2. **prompt**: `prompt-for` の共通部（policy の後、Ticket contents の前）に「AI Ops decision support (AI Ops 判断支援)」節を出す。内容は source と定義版、状態（アラート一覧 / 発火なし / 取得失敗 = 不明）、各アラートの意味、許可された次 action（Notes への証拠保全・切分け・同条件再評価・既承認範囲内の小さな是正提案）、禁止操作（gate/承認/排他の解除、retry/continuation 予算の reset、本番の自動変更、通知の再送、Pod/Hermes の再起動、SLO 達成/未達の宣言）。取得失敗は「アラートなし」と区別して「不明」と明示する。
3. **証拠保全**: `summary.edn` に `:ai-ops-alerts-status`（`"ok"` / `"unavailable"`）と、`"ok"` のときだけ `:ai-ops-alerts`（allowlist 名の vector、重複なし）を `:running` / 終了 / 中断のどの記録にも残す。本文は保存しない。
4. **テスト**: runner self-test（parse の allowlist と並び順、不正応答の拒否、summary 項目の区別、prompt の 3 状態、無効化・env 欠落）、shell テスト 3 件（fake curl: 複数アラート + 非対象 + annotation が prompt / summary に漏れない、取得失敗が不明として記録され空 list にならない、無効化で節なし + 発火なしで空 list）。`task-board-runner-cases.txt` の baseline を 127 → 130 に更新。

## 範囲外

新しい push 通知・Alertmanager 受信先・自動是正・強制停止。固定課題の対照評価（段階 3）。SLO 正式値。

## 配備の注意

本変更は `docker/codex-workspace/**` の image 再 build → argocd-image-updater による codex-workspace Pod の再起動を伴う。段階 1（#14461）と合わせ、Owner が確認した再起動 1 回で反映する。opt-in の env（datasource uid）は lolice `argoproj/codex-workspace/deployment.yaml` の task-board-runner container に別 PR で追加し、同じ再起動で反映する。

## 検証

```sh
bb docker/codex-workspace/task-board/task_board_runner.bb test
TASK_BOARD_TEST_ONLY="test_ai_ops_alerts_prompt_section_and_summary test_ai_ops_alerts_read_failure_is_unknown_not_empty test_ai_ops_alerts_section_absent_when_disabled" tests/codex-workspace/task-board-runner-test.sh
python3 tests/codex-workspace/ci-partition-test.py
# 実環境 read-only（本 Pod 内、uid=P1809F7CD0C75ACF3）: {:status "ok", :alerts []} と節の生成を確認済み（2026-11-04）
```
