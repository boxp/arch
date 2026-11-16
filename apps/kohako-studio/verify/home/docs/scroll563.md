# scroll563.mjs（BOXP-563）

PC と Pixel 7 縦で、手順の連続更新と詳細到着時の追従、読み返し中の位置保持、閉じて開き直した時に最新の手順から見えること（繰り返しと、上へ戻して読んだ後）、DOM の再利用、入力欄と停止ボタンを検証します。上へ戻す操作はホイール操作を伴う形で再現します。

BFF を `npx tsc -p tsconfig.json --outDir <dir>`（`bff` で実行）でビルドし、Web のビルドを `SITE`（既定 `/site`）の `kohako/` に置いて、`BFF_DIST=<dir> node scroll563.mjs /out` を実行します。`PORT` の既定は 8811 です。画像と `result.json` を保存し、失敗時は終了コード 1 です。
