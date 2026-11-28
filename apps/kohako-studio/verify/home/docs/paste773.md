# paste773.mjs（BOXP-773）

`paste773.mjs`（BOXP-773）は BFF をモックし、PC と Pixel 7 相当で「コハコに話しかける」入力欄への貼り付けを確かめます。本物のクリップボード（Ctrl+V）で文字（そのまま入力欄に入り添付しない）とスクリーンショット相当の PNG（添付待ちに入り、送信はしない・取消できる）を貼り、合成の paste イベントで PDF（添付）・未対応形式/サイズ超過（既存の理由文）・Excel 型の文字+画像（文字扱い）・ファイル本体なし（📎 への案内）を貼ります。最後に 📎 選択と貼り付けを混ぜ、本人の送信で `messages` に `attachments` が載り履歴に 📎 が出ることを確かめます。

ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node paste773.mjs /out` を実行します（`CHROME` で実行ファイルを指定可）。失敗時は終了コード 1、結果は `/out/result.json` と各状態の画像です。決まりは Obsidian の `Projects/kohako-home/attachment-paste-spec.md`。
