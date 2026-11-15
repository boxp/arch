# queue.mjs（BOXP-508）

`queue.mjs`（BOXP-508）は token 不要の完全な BFF モックを使い、PC と Pixel 7 相当の送信待ち、FIFO、読み上げ中の追加発言（読み上げを中断しない）、通信切れ時の保留（再接続だけでは送らない）、保留・再開、承認、受理未確認、上限と画面配置を検証します。ビルドを `/site/kohako`、出力先を `/out` に置き、Playwright 1.56.1 で `node queue.mjs /out` を実行します。結果は `result.json` とスクリーンショットに保存され、失敗時は終了コード 1 です。
