# BOXP-360 案 A 第 1 段階: 生成元 metadata ledger + 既存 Prometheus

2026-10-29 に Owner が案 A の本番反映を承認した。承認範囲は、本文なしの allowlist metadata の収集、通常の review/CI/merge と配備、Hermes の再起動 1 回まで。新しい secret・課金・外部送信・Langfuse・生の本文の収集は承認範囲に含まない。

## 構成

| 生成元 | 出力 (PVC 上) | Prometheus | 変更先 |
|---|---|---|---|
| Task Board runner (`task_board_runner.bb` から `ai_ops_ledger.bb` を遅延 load) | `~/.codex-task-board/ai-ops/ledger/events-YYYY-MM-DD.jsonl`、`ledger-stats.edn`、`metrics.prom` | `ai-ops-metrics` sidecar (:9464, read-only) → ServiceMonitor `codex-workspace-ai-ops-metrics` | arch (runner)、lolice `argoproj/codex-workspace` |
| Hermes (`plugins/boxp-ai-ops-observer`、既存 kohako-g2-context と同じく bootstrap で配置・有効化) | `/opt/data/ai-ops/ledger/events-*.jsonl`、`metrics.prom`、`salt` | `ai-ops-metrics` sidecar (:9464、PVC の `ai-ops` subPath だけを read-only で mount) → ServiceMonitor `hermes-agent-ai-ops-metrics` | lolice `argoproj/hermes-agent` |

- 共通 schema は `ai-ops-event/v0`。`tools/ai_ops_sli.bb aggregate` に両方の ledger と既存 metadata の extract をそのまま渡して join できる。Hermes の会話は `conv-` 形式の opaque ID (local salt の SHA-256) を task/request に使う。ticket の無い会話にも ticket の起票を求めずに request_id が付く。
- Prometheus の label は enum 値 (event_type / reason / runtime / status / gate / origin / class) だけに限る。ticket・run・session の ID は ledger 側に置く。
- 観測の失敗で業務を止めない。runner はすべての呼び出しを try で包む。Hermes は callback で bounded queue (1000) に `put_nowait` するだけにし、書き込みは daemon worker が行う。queue 溢れ、日次 file の上限 (8 MiB)、privacy による拒否、書き込みエラーはすべて件数として metrics に出す。retention は 90 日。
- sidecar の `/metrics` は、file が無い・古い場合を `ai_ops_metrics_file_present` / `ai_ops_metrics_file_age_seconds` で示す。scrape の受領だけで「収集できている」とは扱わない。

## 何を取るか (v1)

runner (`definition_version=ledger/v1`)
- `run.started`: `lane_from` を持つ。`ready` は Ready からの受領 (ack) 時刻を表す。
- `correction`: review gate の失敗。classifier=rule、暫定分類。ci / codex-review は agent-system・high。mergeability / conflict / pr-url は agent-system・medium。それ以外は unknown・low。
- `run.finished`: status succeeded / retrying / blocked / superseded、result、exit_code、idle_timeout。
- `lane.changed`: runner が実際に lane を動かしたときだけ出す。
- `run.interrupted`: 計画停止。
- 加えて gate の pass/fail を件数で数える。

Hermes (`definition_version=hermes-observer/v1`)
- turn: `pre_llm_call` で 1 turn に 1 回 `run.started`、`on_session_end` で `run.finished` (succeeded / failed / interrupted) を出す。
- 承認: `pre_approval_request` → `approval.requested`、`post_approval_response` → `approval.resolved`。`approval_key` は pattern key の salted hash で、同じ承認の再要求 (重複承認率) を数えるのに使う。
- `api_request_error` は件数だけを数える。
- callback は必要な metadata 引数だけを宣言する。`**kwargs` は使わない。配備版の dispatcher (`hermes_cli/plugins_dispatch.py` `_hook_callback_kwargs`) は宣言された名前の引数だけを渡すことを確認済みなので、本文・履歴・command・tool args は plugin に渡らない。

## 既知の限界 (coverage は別に報告する)

- Ready に入った時刻は runner が観測しない。Ready→ack の遅延を出すには、board-diff 由来の Ready 遷移時刻との join が要る (次段階)。
- Hermes の承認 hook は `session_key` だけを持ち、turn hook は `session_id` を持つ。そのため承認と turn は同じ task に join されない。同じ承認の重複は session_key の中で数える。
- Hermes の `approval.resolved` の choice (許可/拒否) はまだ取らない。Owner 救援 (催促) は metadata だけでは判定できないので、引き続き unknown とする。
- Hermes の counter は plugin 起動からの値で、再起動で 0 に戻る (Prometheus の counter reset として扱われる)。ledger は PVC 上に永続する。
- ledger の SLI を Prometheus に出す処理 (ledger + extract の aggregate を定期実行する) は、2〜4 週の baseline 収集と並行して次段階で行う。第 1 段階で Prometheus に出すのは、生成元の counter と収集の健全性。

## 配備と確認

1. arch PR (runner) を merge する → codex-workspace image を build → image updater が反映する (codex-workspace pod が再起動する。runner は計画停止の経路を通る)。
2. lolice PR を merge する → Argo CD が同期する。hermes-agent pod は ConfigMap の hash が変わるので 1 回だけ再起動する (Recreate)。codex-workspace pod も sidecar の追加で再起動する。
3. readback で次を確認する。
   - 実 run 後に ledger の行と `ledger-stats.edn` が更新されている。
   - Hermes の turn 後に `/opt/data/ai-ops/ledger` に行がある。
   - Prometheus の `up{job=~".*ai-ops-metrics"}`、`ai_ops_ledger_events_total`、`ai_ops_hermes_events_total` が query で取れる。
   - `ai_ops_metrics_file_age_seconds` が小さい。
   - aggregate で runner/Hermes の ledger と extract が join できる。

Hermes の plugin API は配備版を read-only で調べた (`hermes-plugin-investigation.md`)。
