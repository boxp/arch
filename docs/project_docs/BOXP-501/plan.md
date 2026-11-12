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
- payload は題名と伏字済みの短い本文を表示する（TD-01）。`KOHAKO_PUSH_CONTENT=minimal` で従来の固定文に戻せる。tag=eventId、url=`/kohako/home.html?notification=<eventId>`。
- 静音 02:00–09:00 JST は push しない(inbox には保存)。TTL 24h。
- 対応: Chrome/Edge/Firefox(デスクトップ/Android)、iOS/iPadOS Safari 16.4+ はホーム画面に追加した PWA のみ。ブラウザ完全終了・OS 省電力・push service 側の都合では配信を保証できない。

## 既存契約
- 02:00–09:00 JST 静音、Task Board の defer/quiet-held、Alertmanager critical 例外、サンライズ例外は変えない。
- Telegram は一括停止しない。家とTelegramの会話履歴は統合しない。

## 段階3' (TD-02): Telegram 実配信本文の複製

Hermes は Telegram への送信成功後、receipt より先に実送信本文を delivered-copies に原子的に保存する。dispatcher は同期された本文をそのまま家の受信箱へ転送し、選択肢を抽出する。silent、quiet-held および未送信の event は家へ出さず、静音中の内容は朝 digest の実配信本文で届ける。コピーが未着の場合は期限まで待つ。BFF は同一 event ID の重複を防ぎ、旧方式の raw 項目を一覧と未読数から除外する。cron、Alertmanager、サンライズは未接続で、Telegram を維持し次段階で扱う。

### ビルド障害対応: Ubuntu 取得先の国内ミラー切替 (2026-11-11, Owner 承認済み)

- 理由: archive.ubuntu.com が GitHub runner と cluster の両方で名前解決できず、Codex Workspace Image の `apt-get update` が失敗した。
- 変更: `docker/codex-workspace/Dockerfile` で本体 archive の `URIs` だけを `http://linux.yz.yamagata-u.ac.jp/ubuntu/` へ置き換える。security.ubuntu.com、OS 版、署名検証の設定は変えない。
- 確認: resolute-updates の InRelease は公式の security.ubuntu.com 上の同じファイルと日時が一致した。Ubuntu Archive 署名鍵で正しい署名と確認した。digest を固定した base image (26.04/amd64) で apt update とパッケージ取得が成功した。
- 戻し方: build-arg `UBUNTU_ARCHIVE_MIRROR=http://archive.ubuntu.com/ubuntu/` を渡すか、ARG の既定値を戻す。

### 家宛てIDの分離 (codex-review P1 対応)
- 家の受信箱へは `<event>.report`(Telegramへ送った正式報告) と `<event>.notice`(照合通知) を別IDで送る。照合通知が先に届いても後の正式報告が重複扱いで消えない。
- 旧方式(票の変更一覧を送っていた頃)の家宛て状態 `<event>.edn` とBFF項目 `<event>` は参照しないため、旧方式で送信済みの event も実配信本文があれば受信箱に表示される。
- 家からの返信でHermesへ渡す event ID は接尾辞を除いた元の event ID。

### TD-01: foreground案内と内容のあるWeb Push
- Web Push は題名と短い本文を表示し、URL、2階層以上の絶対パスやホームパス、長いトークン、メールアドレスを伏字にする。`KOHAKO_PUSH_CONTENT=minimal` で固定文に戻せる。
- 家を開いているときは未読・未処理の新しい通知を案内し、案内済み状態をサーバーに保存する。返信・選択は受信箱と同じ経路で送る。

### TD-03 CRON通知
- 方針: Telegram 配送成功後の伏字済み本文を同期し、dispatcher から家へ複製する。
- 対象job種別: agent、no_agent/script、失敗通知、単発リマインダー、サンライズ監視。
- 不変条件: schedule、prompt、model、配送先と Telegram 配信を維持する。
- rollback: dispatcher の HOME URL を無効化、または配送パッチを revert する。
- 未了: 主配信の切替は並行配送の検証後に判断する。
