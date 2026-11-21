# BOXP-648: kohako-home の位置情報を本人同意のもとでコハコの会話コンテキストへ接続する

## 方針
- 家の設定に「現在地をコハコに伝える」（既定 OFF・端末ごと）を追加する。ON の操作直後に 1 回取得してブラウザの許可を本人の操作に結び付ける。
- ON の間だけ、発言の送信直前に `navigator.geolocation.getCurrentPosition` で 1 回取得する（2 分以内の取得は再利用、6 秒で打ち切り）。`watchPosition`・背景追跡・移動履歴は使わない。直近 1 件をタブのメモリにだけ持ち、localStorage・送信控え・送信待ち・会話履歴には保存しない。
- 送信本文に `location`（`{status:'ok',lat,lon,accuracy,capturedAt}` または `{status:'off'|'denied'|'unavailable'|'timeout'|'unsupported'|'stale'}`）を添える。現場（見てきて）・ふれあい・通知返信・Studio には添えない。
- BFF は家の text turn（`views: true`）だけ受け付けて検証し（範囲・型・未来時刻、10 分超は stale）、Hermes の `instructions`（ephemeral system prompt。session 履歴に保存されない）にその turn だけ載せる。Input・冪等 hash・会話ストア・ログには入れない。
- 有効な位置が無い turn には「以前の会話に出た場所や過去の位置を今いる場所と断定しない」指示を渡し、共有停止後・拒否・失敗・期限切れで現在地として使わせない。
- 位置ありの指示には、座標（小数 4 桁）・精度・取得時刻と経過分、精度 1km 超は「付近」扱い、記憶/vault/ナビログ/票/通知/外部投稿へ保存しない、返答に座標を書かない、案内に必要な場合以外は外部サービスへ送らない、を含める。
- 逆ジオコーディング等、BFF からの新しい外部送信は追加しない。verifier は別 session（kohako-verify）なので本人会話へ混入しない。

## 検証
- BFF/Web の単体テスト（parse・指示文・app 経由で turn 指示にだけ載ること、停止後に座標が消えること、touch/Studio/不正値の 400、verifier の session 分離）。
- `verify/home/location648.mjs`（架空位置・BFF モック）で PC/スマホ × 許可/拒否/取得失敗/共有停止/見てきて。
- 配備後: 配備版で verifier 会話に架空位置を送り、実 Hermes が位置を参照し・共有停止後は断定しないことを確認。本人端末での実取得は本人操作（ブラウザ許可）が必要。
