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

## 追加（2026-10-22 後半）: 返信文脈継承 — webhook 配信の session mirror backport

Owner 確認で、Telegram には通知が届くが「event で受け取った内容が会話 context に反映されていない」ことが判明（Kohako が短い返信を別話題と誤解）。配備版 Hermes v0.18.0 は `gateway/mirror.py` の `mirror_to_session` を同梱し cron `attach_to_session` では使っているが、webhook adapter は上流 main の route option `mirror_to_session` を未実装だった。

- `docker/hermes-agent/patches/add-webhook-mirror-to-session.py`: 上流と同じ 3 点（delivery info に `route`/`mirror` を保持、`_deliver_cross_platform` の送信成功後に `_mirror_delivery`、`[Webhook delivery: <route>]` 付き user turn で `mirror_to_session`）を v0.18.0 の形に合わせて挿入。既定 off、失敗しても配信結果を変えない。全置換箇所が一意に一致しなければ build を失敗させ、冪等（再適用は no-op）。
- Dockerfile で patch 適用後に `py_compile`。PR の image build job が適用可否を検証する。
- 配備: main merge → image build（latest/sha-*）→ argocd-image-updater（newest-build、git write-back）→ lolice pin 更新 → Argo sync で hermes-agent Pod 再作成（Telegram 短時間停止）。lolice 側で route に `mirror_to_session: true` を設定する（lolice PR は image 配備後に merge）。
- 検証: Pod 内で patch 適用版を stub 付きで実行（home chat / 明示 chat+thread / 既定 off / 送信失敗時は非 mirror / mirror 例外でも配信成功 / `send()` 経路）。配備後は fixture event で gateway log `delivery mirrored into telegram:<chat> session` と DM session への user turn 追加、Reply なし短文返答の文脈継承を実機確認する。
