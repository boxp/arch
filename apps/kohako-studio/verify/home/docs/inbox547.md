# inbox547.mjs（BOXP-547）

`inbox547.mjs`（BOXP-547）は BFF を完全にモックし、PC と Pixel 7 相当で通知更新中の返信本文・要素・フォーカス・選択範囲、通知別の下書き、送信先、選択肢と返信済み表示、外部通信 0 件を検証します。更新は `visibilitychange` を発火して行います。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node inbox547.mjs /out` を実行します（`PORT` 既定 8807）。結果は `result.json` に保存し、失敗時は終了コード 1 です。
