# attach677.mjs（BOXP-677）

`attach677.mjs`（BOXP-677）は、配備イメージの nginx（`nginx.conf` と web build）と `bff/dist` の本物の BFF（`createApp`・添付・会話。認証は Owner 固定、Hermes は入力を記録する偽物）をつなぎ、PC と Pixel 7 相当で PDF 添付を確かめます。

- 30 MiB ちょうどの PDF が届き「✓ 本文読取済（3ページ）」になること、30 MiB + 1 バイトは画面で止めてサイズ・バイト数・次の手順を出すこと。
- 未対応形式・本文なし（スキャン相当）・壊れた PDF・31 ページ（一部読取）・BFF 停止（nginx の 503）・通信断の理由が入力欄の上の注意欄に出ること、入力欄と送信が画面内に残ること。
- 画面を迂回した直接送信でも、30 MiB + 1 バイトは BFF が、31 MiB 超は nginx が `413 {"error":"too_large"}` を返すこと。
- 一部読取の PDF を送ると Hermes への入力に「全31ページのうち先頭30ページだけ」が入り、31 ページ目の本文は入らないこと。

手順: `bff` で `npm run build`、イメージを build（`docker build -t kohako-studio:local apps/kohako-studio`）し、BFF の待受を 127.0.0.1:8788 に向けた upstream で nginx を起動します（`printf 'upstream kohako_bff { server 127.0.0.1:8788; keepalive 8; }\n' > /tmp/up.conf; docker run --rm -d --network host -v /tmp/up.conf:/etc/nginx/kohako-upstream.conf:ro kohako-studio:local nginx -g 'daemon off;'`）。Playwright 1.56.1 で `node attach677.mjs /out` を実行します（`BASE`・`BFF_PORT`・`BFF_DIST`・`CHROME` で変更可）。失敗時は終了コード 1、結果は `/out/result.json` と各状態の画像です。
