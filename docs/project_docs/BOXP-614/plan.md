# BOXP-614: 夜間ミュートと家の受信箱への保存を分離する

Owner 承認: 「夜間も受信箱へ随時保存し、Telegram・Webプッシュ等の呼出しだけ抑える」に「そうしましょう」。

## 現状（調査結果）

02:00〜09:00 JST に Task Board 通知が家の受信箱へ届かない原因は 2 段ある。

1. dispatcher（`docker/codex-workspace/task-board/task_board_events.bb` の `flush-pending!`）は静音時間中、
   `outbox/night-processing.edn` の許可票（BOXP-409 の段階有効化。現在は canary の BOXP-424 のみ）以外の event を
   Hermes へ送らず、朝まで保留する。本文がそもそも作られない。
2. 送った場合も、boxp-notify（lolice `argoproj/hermes-agent/plugins/boxp-notify`）の gate は保留（`held`）時に
   家の写しを書かず `quiet-held` receipt だけ残して終わる。夜間 prompt は最終応答を `[SILENT]` 固定にしている。

呼出し側はすでに静音になっている: Web プッシュは家 BFF（`apps/kohako-studio/bff/src/push.ts`、`KOHAKO_PUSH_QUIET_HOURS` 既定 2-9）が抑止、
Telegram 催促/fallback は dispatcher の `flush-home-reminder!` が静音中は送らない（かつ `primary: home` の写しだけが対象）。

## 設計

保存（家の受信箱）と呼出し（Telegram・Web プッシュ・催促）を分ける。

- dispatcher（arch）
  - `CODEX_TASK_BOARD_EVENT_NIGHT_INBOX=true` のとき、静音時間中も許可票以外の event を `notify_mode=inbox` で送る。
    許可票は従来どおり `defer`（409 の夜間調整）。digest は夜間に送らない。env を外せば従来の夜間保留へ戻る（既定 off）。
  - 朝の digest 作成時、家へ保存済み（home state `:sent` / stored）で家側の状態が既読・対応済み・返信済みの項目は
    digest に載せず done にする（`:home-acknowledged true`）。状態不明・未保存・家から消えた項目は従来どおり digest に載せる（欠落させない）。
- boxp-notify（lolice）
  - 保留（静音・digest claim・deferred）した Task Board 本文を家の受信箱へ `primary` 印なしで保存する。
    Telegram へは送らず、印なしなので dispatcher は催促も Telegram fallback もしない。`quiet-held` receipt は従来どおり書くので、
    dispatcher の朝回収（notify-pending → digest）は変わらない。digest event 自体は保存しない（朝に再発行されてから保存される）。
  - marker `deferred` の報告本文は「記録不一致」の注記を付けず report として扱う（保留されるので送信はされない）。
- Hermes route prompt（lolice configmap）
  - `notify_mode=inbox` は夜間扱いで、継続操作（状態変更・再 queue・helper の限定実行）を一切しない。
  - 夜間（defer / inbox）で本人判断・重要成果を伝える必要がある時は `result=deferred` を残し、最終応答を昼と同じ形式の本文にする。
    伝えることが無ければ `[SILENT]`。
- lolice `argoproj/codex-workspace/deployment.yaml` に `CODEX_TASK_BOARD_EVENT_NIGHT_INBOX="true"` を追加して有効化。

## 保護する既存契約

- 409: 許可票の `defer`（夜間調整・継続）、receipt による完了判定、digest の claim/再発行は変更しない。
- 554: 昼の家中心配信（`primary: home`、催促、Telegram fallback、照合通知）は変更しない。
- 範囲外: 通常メール/生活 cron の夜間実行、新権限・課金、静音時間そのものの解除。

## 既知の差・トレードオフ

- 許可票以外の event は夜間に「通知のみ」で処理されるため、従来 09:00 以降の処理で起き得た hook からの継続操作は行われない。
  継続は朝以降の照合（cron）と次の event に任せる（prompt で本文と summary にその旨を残す）。
- 家で未読の夜間項目は朝の digest で再度まとめて通知する（欠落より重複を許す既存方針）。
- 既存の夜間保留（pending の event）は消さない。有効化後の夜間 tick で inbox mode として送られ、同じ経路で回収される。

## 配備順と切戻し

1. arch PR を merge（dispatcher image。env 未設定なら挙動は変わらない）。
2. lolice PR を **静音時間外（09:00〜02:00 JST）に** merge（prompt / plugin / env を同時反映。旧 prompt が inbox を昼扱いしないよう、
   次の 02:00 までに Hermes と codex-workspace の rollout を終える）。
3. 夜間の実経路で: 家への保存、Telegram/Web プッシュ/催促なし、朝の digest で既読項目が除外されることを readback。
- 切戻し: lolice の env を外す（従来の夜間保留へ）。plugin の家保存は lolice PR の revert。

## 検証

- arch: `tests/codex-workspace/task-board-events-test.sh`（inbox mode の送信・許可票優先・既定 off・digest は夜間に送らない・
  inbox 項目の digest 回収）、`task-board-reminder-test.bb`（既読/対応/返信済みは digest から除外、未読/未保存/消失/不明は残す）。
- lolice: `boxp_notify_check.py`（夜間の deferred 本文は家へ保存・選択肢保持・Telegram なし・印なし・quiet-held、digest は保存しない、
  既存の静音/claim/回復の期待値更新）、notify-lab stage2 の期待値更新。
