# BOXP-658: kohako-home の受信箱返信を応答待ち中にもキューへ積めるようにする

## 原因

受信箱の詳細・吹き出しのお知らせからの返信は `web/src/home/inbox.ts` の `send()` が即時に `POST notifications/{id}/reply` を呼ぶ。
BFF は返信の claim を保存してから `conv.submit` を呼び、進行中 run があると `busy` → `submit_failed` を保存していた。
画面は「送信を確認できませんでした・同じ返信を再送」となり、BOXP-508 の送信待ち（入力欄の本文だけを扱う）には入らなかった。

## 方針

- 送信待ちは引き続き画面側（タブのメモリ）に 1 本だけ持ち、通常の発言と通知返信を同じ FIFO・同じ上限（5 件／500 字）に混在させる。BFF に待機機能・未送信本文の保存は追加しない。
- `QueueItem.notice = { eventId, ticketId?, source, title, kind, value, replyId }`。replyId は登録時に固定し、既存の `sessionStorage kohako-reply-{eventId}` と同じ値を使う。同じ通知への待機は 1 件まで。
- 受信箱・吹き出し（共通の `send()`）は、応答待ち・読み上げ中・送信待ちあり・受理未確認の間は BFF へ送らずに積み、詳細に「送信待ち（未送信）」と「取消」を出す（返信済み・処理済みに見せない）。
- 画面が空いていて直接送った返信に BFF が 429 busy（別端末の依頼が進行中など）を返したら、本文を失わないよう送信待ちへ積んで `busy` 保留にし、「再開」で同じ replyId を送る。吹き出しのお知らせはこの画面で会話を始めると操作欄が閉じるため、吹き出し経路で積まれるのは主にこの場合。
- 送信待ちの先頭が通知返信なら、通知一覧で最新状態を確かめてから返信 API へ送る。
  - 別 replyId で返信済み → `notice_replied`、通知なし → `notice_gone`、選択肢に値なし → `notice_invalid` で送らずに保留（本文は残し「取消」で次へ）。
  - 409/404/400 も同じ。429 busy → `busy` 保留。401/403 → `auth` 保留。通信例外・5xx → `unknown` 保留（再開時は同じ replyId でのみ再送）。`submit_failed` → `failed` 保留。
  - 受理（submitted）後は既存の `followRequest` で同じ会話の応答を追う。
- BFF: `notifications.reply` に `busy()` 引数を追加し、会話が進行中なら未受理（submitted でも run 記録済みでもない）返信は claim を保存せず `busy` を返す（HTTP 429）。既存の 1 回制・同じ replyId の冪等・再起動後の追跡再開・23h 期限は従来どおり。
- 再認証の手動再読み込み時の一時退避は、通知返信を文脈ごと退避し（通常発言に変換しない）、復元後は保留。
- 送信待ちの取消で自由文の通知返信は、その通知の下書きへ戻す。
- 一度返信 API へ送った通知返信（`attempted`、再認証の退避にも保存）は fail-closed で扱う: サーバーが「実行しない」と確定した場合（同じ replyId が `submit_failed`・別 replyId が先に返信済み・通知が BFF に無い）だけ取り消し、未返信に見える・`claimed`・確認不能では取り消さずに保留して同じ replyId の「確認して再開」を案内する。受理済み（`submitted`）なら取り消せなかった旨を出して応答を追う。個別・一括取消とも同じ判定（BOXP-588 の同一ファイル連続指摘を受けた設計変更）。

## 657 への申し送り

657 設計正本 §2/§7-7 の「会話が進行中の返信は submit_failed になり、送り直せる」は、本票で「429 `busy`（claim なし・未返信のまま）」に変わる。G2 受信箱返信は 429 busy を「後で送る／送信待ち」として扱う。

## 検証

- unit: `bff/src/notifications.test.ts`・`bff/src/app.test.ts`（busy→429・未保存・再送時冪等）、`web/src/home/queue.test.ts`・`reauth.test.ts`。
- BFF モック実ブラウザ（PC/Pixel7）: `verify/home/inboxqueue658.mjs`。
- 配備後: 配備版 sha で PC/スマホの実画面操作。実 Hermes 経路の結果はモックと分けて正本へ記録する。

## rollback

PR revert（BFF・web とも同じ image のため revert → image-updater で戻る）。
