# BOXP-270 Task Board → Hermes イベント駆動連携（arch 側: outbox + dispatcher）

Obsidian 正本: `Projects/BOXP-270/README.md`（目的・before/after・安全境界・証拠・rollback）。本書は arch repo の実装計画。

## 目的

Task Board runner の確定遷移（Blocked / Review / Done）を永続 outbox に記録し、署名付き内部 Webhook で Hermes（コハコ）を即時起動する。30 分 cron の全件 LLM 走査を、実経路確認後に低頻度の軽量照合へ縮小するための送信側。

## 実装

- `docker/codex-workspace/task-board/task_board_events.bb`（新規）
  - `record-run-event!`: runner が lane / frontmatter / Notes を確定した後に `<root>/outbox/pending/<ticket>-<run-id>-<to>.edn` を原子的に書く。対象は `blocked` / `review` / `done` のみ。開始・heartbeat・idle-timeout 再試行・groom→ready は記録しない。
  - Board レーン差分（`outbox/board-lanes.edn` snapshot）: 手動 Board 編集で trigger レーンに入った票を `task-board.lane-changed` として記録。runner 由来イベントと同 ticket / 同 to-status が 15 分以内にあれば一本化。初回は snapshot 作成のみ。
  - dispatcher (`loop` / `tick`): 02:00–09:00 JST は送信せず outbox に保全。HMAC-SHA256 V2（`X-Webhook-Timestamp` + `X-Webhook-Signature-V2`、`X-Request-ID`=event id）で POST。失敗は指数 backoff（15s→最大 600s、既定 40 回で `failed/`）。2xx は `:accepted` に留め、ticket Notes の `handled event=<id>` 行を見て `done/` へ。30 分で marker が無ければ同 ID で再配信（最大 2 回）、尽きたら `unhandled/`。
  - payload は snake_case の名前付き最小項目（event_id / ticket_id / run_id / from_status / to_status / result / source / revision / created_at / attempt / redelivery）。秘密値・本文を log に出さない。
- `task_board_runner.bb`: モジュールを lazy load し `record-task-board-event!` を 3 箇所（通常遷移・gate 由来 blocked・例外 blocked）で呼ぶ。失敗しても run に影響しない。`CODEX_TASK_BOARD_EVENTS_ENABLED=false` で無効化。runner container は secret を持たない（送信は別 sidecar）。
- CI: `tests/codex-workspace/task-board-events-test.sh`（偽 Hermes 受信サーバで署名検証・重複・停止/復旧・5xx 上限・静音延期と順序・JST 境界・手動編集検出・一本化・handled 完了・再配信→unhandled・非 trigger 無視・secret 欠落）と runner 回帰 3 件を `test-codex-task-board-runner.yml` に追加。

## 環境変数（dispatcher）

`CODEX_TASK_BOARD_ROOT`, `CODEX_TASK_BOARD_VAULT`, `CODEX_TASK_BOARD_EVENT_WEBHOOK_URL`, `CODEX_TASK_BOARD_EVENT_WEBHOOK_SECRET`, `CODEX_TASK_BOARD_EVENT_POLL_SECONDS`(30), `CODEX_TASK_BOARD_EVENT_QUIET_HOURS`("2-9")、`..._DEDUPE_SECONDS`(900)、`..._HANDLE_TIMEOUT_SECONDS`(1800)、`..._MAX_REDELIVERIES`(2)、`..._MAX_ATTEMPTS`(40)、`..._MAX_BACKOFF_SECONDS`(600)、`..._DONE_RETENTION_DAYS`(14)。

## 検証

```bash
bb docker/codex-workspace/task-board/task_board_events.bb test
tests/codex-workspace/task-board-events-test.sh
tests/codex-workspace/task-board-runner-test.sh
```

## 配備順序

1. 本 PR merge → image build → image updater が lolice の `codex-workspace` を rollout。
2. lolice PR-A（hermes-agent Service / Ingress NetworkPolicy / ESO Password Secret / `WEBHOOK_SECRET` env / subscription 書込み、codex-workspace 側の SecretStore / egress NetworkPolicy）。
3. lolice PR-B（codex-workspace に `task-board-event-dispatcher` sidecar）。Pod 再作成で実行中 run は planned shutdown。
