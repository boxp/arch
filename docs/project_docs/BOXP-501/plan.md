# BOXP-501: kohako-home 通知受信箱・Web Push・返信導線（Telegram からの段階移行）

正本: Obsidian `Tickets/BOXP-501`, `Projects/kohako-home/request`(段階2), `Projects/kohako-home/telegram-parity-tools-and-web-notifications.md`。
前提: BOXP-500(家)・BOXP-503(Telegram 同等ツール)は Owner 本人受入済み(2026-11-11 09:21 UTC)。

## 方針
- Hermes に新しい配信 platform は生やさない。送信側の正本(Task Board outbox/event ID)から BFF の認証付き受信口へ **複製配信** し、Telegram 経路はそのまま fallback として残す。
- 家の通知は BFF が永続 inbox(Pod の PVC 上 JSON、event_id 一意 upsert)に保存し、非 foreground/閉タブには標準 Web Push(Service Worker + VAPID, RFC 8030/8291/8292)で知らせる。新しい外部課金サービス/アカウントは使わない(ブラウザ標準の push service へ既存の 443 egress で送るだけ)。
- 通知本文は Owner 指示/承認として扱わない。家から明示した返信/選択だけを event_id/ticket 付きで既存 `kohako-web` Owner セッションへ送る。

## 段階
1. **(本PR, arch)** BFF: 永続 inbox・受信口・既読/処理済み・返信 claim・Web Push 購読/送信。Web: 受信箱 UI・通知許可ボタン・Service Worker・クリック復帰。`KOHAKO_DATA_DIR` 未設定なら機能無効(既存挙動不変)。
2. **(lolice)** kohako-studio に PVC と `KOHAKO_DATA_DIR`、受信用 projected token audience(`kohako-bff-notifier`)を codex-workspace 側に追加。
3. **(arch docker/codex-workspace)** Task Board dispatcher に家宛て複製配信(Telegram 送信とは独立した状態・再試行、失敗しても Telegram 経路に影響しない)。
4. 並行検証: 実イベントで家/Telegram 両方の到達・遅延・重複を記録。BFF 再起動・家未接続・重複配信・permission 拒否/失効・閉タブ受信・クリック復帰。
5. 種類単位の主配信切替(Task Board 通知→cron 要約)。未読が一定時間残れば Telegram へ短い催促。rollback は種類単位で Telegram 主配信へ戻す設定。Alertmanager critical とサンライズは安全な代替が確認されるまで Telegram 維持(暫定)。

## 受信口と認証
- `POST /kohako/api/v1/notifications/ingest`: principal `notifier` のみ。Kubernetes TokenReview(audience `kohako-bff-notifier`、username = codex-workspace SA)。verifier の token(audience `kohako-bff-verifier`)では受け付けない。Access JWT(Owner)でも受け付けない。
- 既存 NetworkPolicy で codex-workspace → kohako-studio:8080 は許可済み。push service への 443 egress も許可済み。

## inbox schema(1 件)
`eventId`(一意), `source`(task-board / alertmanager / hermes-cron ...), `eventType`, `ticketId?`, `runId?`, `title`, `body`, `choices?`, `createdAt`(送信側), `receivedAt`, `deliveries`(重複受信回数), `readAt?`, `handledAt?`, `reply?{replyId, text|choice, requestId, claimedAt, status}`。
- 同一 eventId の再受信は内容を上書きせず `deliveries` だけ増やし、push も再送しない。
- 返信は event ごとに 1 回の claim を永続化してから Hermes へ送る。同じ `replyId` の再送は同じ結果を返し、別 replyId は 409。
- 保存は一時ファイル→rename の原子的書き込み。上限件数を超えたら古い処理済みから削除。

## Web Push
- VAPID 鍵は初回起動時に BFF が生成し `KOHAKO_DATA_DIR` に 0600 で保存(値は API/ログに出さない。公開鍵のみ返す)。
- 購読: Owner がボタンを押したときだけ `Notification.requestPermission()`。拒否/未許可時は再 prompt せず inbox と Telegram fallback を案内。端末ごとに OFF(購読解除)。push service が 404/410 を返した購読は削除。
- payload は最小: タイトル「コハコ」、本文「コハコからお知らせがあります」、tag=eventId、url=`/kohako/home.html?notification=<eventId>`。ロック画面に ticket 詳細や本文を出さない。
- 静音 02:00–09:00 JST は push しない(inbox には保存)。TTL 24h。
- 対応: Chrome/Edge/Firefox(デスクトップ/Android)、iOS/iPadOS Safari 16.4+ はホーム画面に追加した PWA のみ。ブラウザ完全終了・OS 省電力・push service 側の都合では配信を保証できない。

## 既存契約
- 02:00–09:00 JST 静音、Task Board の defer/quiet-held、Alertmanager critical 例外、サンライズ例外は変えない。
- Telegram は一括停止しない。家とTelegramの会話履歴は統合しない。
