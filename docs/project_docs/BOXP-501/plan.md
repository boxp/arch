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

## TD-01 追補: 家経由で依頼した票の通知欠落（2026-11-12）

- 原因: Task Board webhook の prefilter（lolice `task_board_webhook_filter.clj`）と route prompt 手順2は、監督 runbook `/opt/data/kohako-task-supervision.md` に登録が無い票の event を `result=silent` にする。Telegram 経由の依頼は Hermes が runbook へ登録していたが、家（kohako-web session）経由の依頼は登録されず、BOXP-506/510/511/514 の停止・完了 event が silent になり、Telegram 実送信本文コピーも生まれないため家にも届かなかった。
- 修正: BFF が Owner の発言 turn（家/Studio のテキスト・通知への返信）にだけ「起票・再依頼・引き継ぎをしたら Telegram と同じ書式で report-only 登録し読み戻す」指示を付ける。verifier・なでる turn には付けない。prefilter・route prompt・silent 判定は変えない（一律解除しない）。
- 既存票の回復: runbook は Hermes PVC 上で他 profile から編集しないため、Kohako への引継ぎ（vault `Projects/kohako-home/home-task-registration-handoff.md`）で登録と未配信の必要分だけの一回回復を依頼する。
- 戻し方: `ownerTaskInstructions` の付与を外す revert。

## TD-05: 種類単位の主配信切替・Telegram へ戻す手順・未読催促（2026-11-12, Owner 本人受入後）

前提: Owner が家の通知(event BOXP-501-20261112T121502Z-…-blocked)へ「全部大丈夫です」と返信し、地図・受信箱・閉タブ Push を本人確認済み。承認範囲は「家の実配信確認後の主配信移行」(2026-11-12 01:10 UTC Notes)。Telegram の一括停止・新権限・新課金は含まない。

- 切替の正本: vault `Projects/task-board-events/delivery-routing.md` の行 `task-board: home|telegram`（無い・読めない・不正は telegram）。**既定は telegram**（配備しただけでは挙動不変）。この PR の対象は Task Board 通知だけ。cron 要約は同じ仕組みで後から評価し、Alertmanager critical とサンライズは Telegram 維持。
- Hermes 配信 gate（`boxp_task_board_delivery.py`）: `task-board: home` のとき、Task Board の正式報告は Telegram へ送らず、実配信本文コピー（`primary: home` 付き）を保存できた時だけ送信済み扱いにする。コピーの保存に失敗したら従来どおり Telegram へ送る。照合通知（【Task Board 配送要確認】）と静音保留・digest の扱いは変えない。
- dispatcher（`task_board_events.bb`）: `primary: home` のコピーは家へ転送したうえで、
  - 家への保存が恒久失敗・期限内に保存できない → Telegram へ本文をそのまま送る（fallback、1 回だけ）。
  - 保存後 `CODEX_TASK_BOARD_HOME_REMINDER_MINUTES`(既定 30) 分たっても既読・処理済み・返信が無い → Telegram へ短い催促（題名と家の URL のみ、1 回だけ）。
  - 静音 02:00–09:00 JST は送らず 09:00 以降へ持ち越す。状態は `outbox/home/<event>.report.edn` に永続化し二重送信しない。
- Telegram への送信は Hermes の新しい deliver_only webhook route `kohako-home-reminder`（LLM なし、既存の task-board と同じ global WEBHOOK_SECRET の HMAC 署名、lolice で登録）で行う。
- BFF: notifier だけが読める `GET /kohako/api/v1/notifications/status?ids=…`（既読・処理済み・返信の有無だけ。本文は返さない）。
- rollback（種類単位）: `delivery-routing.md` を `task-board: telegram` に戻すと、次の通知から Hermes が Telegram へ本文を送る（再配備不要）。切替済みで未読の通知の催促は続く。
- 催促・fallback は Telegram 相当の送信時刻から `CODEX_TASK_BOARD_HOME_REMINDER_MAX_AGE_HOURS`(既定 24) 時間以内の通知だけを対象にし、保存期限で状態が消えた古い通知へ再送しない。保存期限(prune)は既存と同じ。
