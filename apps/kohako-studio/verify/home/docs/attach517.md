# attach517.mjs（BOXP-517）

`attach517.mjs`（BOXP-517）は BFF を完全にモックし、PC と Pixel 7 相当で添付の選択・チップ表示・取消、未対応形式/サイズ超過/PDF 本文なしの明示、添付付き送信（messages に attachments が載る）と履歴の 📎 表示、入力欄・送信が画面内に残ることを確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node attach517.mjs /out` を実行します（`CHROME` で実行ファイルを指定可）。失敗時は終了コード 1 です。
