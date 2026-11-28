# notice756.mjs（BOXP-756）

`notice756.mjs`（BOXP-756）は BFF を完全にモックし（TTS は 0.6 秒の無音 wav）、PC 幅で読み上げ ON/OFF のときの新着通知・会話の返答・通知返信の返答の読み上げを検証します。期待値は vault の `Projects/kohako-home/notice-read-aloud-spec.md` から取ります。

- 確かめること: 新着通知の見出しと本文を読む／URL を読まずに「GitHub のリンク」などと読む／読み上げ中の新着は重ねず読み終えてから読む／再読込で案内済みの通知を読み直さない／「止める」で止まり勝手に再開しない／「続きから読む」が出ている間の新着は表示だけ／OFF では読まない／会話と通知返信の返答の本文を読む／外部通信 0 件。
- 実行: ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node notice756.mjs /out`（`PORT` 既定 8856）。結果は `result.json`（TTS へ送った文の一覧つき）と画面写真。失敗時は終了コード 1。
