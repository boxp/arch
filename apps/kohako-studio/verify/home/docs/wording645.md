# wording645.mjs（BOXP-645）

`SITE=<site root> CHROME=<chromium executable> node wording645.mjs <out>` を Playwright 1.56.1 で実行します。
`SITE/kohako/` に Web build を置きます。大きな public 素材はコピーせず、build の `kohako` から `web/public/kohako` に symlink します。Vite API の `build({publicDir:false})` を使えます。

API は全てモックし、実会話・通知返信・承認を送信しません。PC 1280×800、スマホ縦390×844・横844×390で、草稿のみ復元時に送信待ち0件の表示がないこと、設定補足の横はみ出しがないこと、録音終了・送信待ちに追加のボタンと読み上げ名が収まることを確認します。Chromium の仮想マイクを使い、人の音声は録音しません。

結果とスクリーンショットは `<out>` に保存します。vault 内を指定しないでください。音声の聴感・実機Safari・Cloudflare本人認証はこの検証の対象外です。
