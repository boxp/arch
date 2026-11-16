# inbox568.mjs（BOXP-568）

BFF をモックし PC と Pixel 7 相当で選択肢と自由文の併存、通知別下書き、更新時フォーカス、空白送信、同名の自由文、選択肢、失敗後の再送と二重送信防止を検証する。Playwright 1.56.1 で `SITE`（既定 `/site`）の `kohako/` にビルドを用意し、`node inbox568.mjs /out` を実行する（`PORT` 既定 8808）。結果は `result.json`、失敗時は終了コード 1。外部通信も失敗扱い。
