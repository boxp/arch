# BOXP-647 オーバーレイ操作と返答

`RUN_WORKSPACE` に Playwright 1.56.1 をインストールした作業領域、`SITE` にビルドの配信ルート、`CHROMIUM` に Chromium の実行ファイル、`MODEL_TRACES` に `overlay-model/traces.txt` を指定し、`node overlay647.mjs <出力先>` を実行する。`PORT` の既定は8848。BFFはモックし、ブラウザの外部通信は遮断する。

画像は複製しない。`PUBLIC` に既存の `web/public` を指定すると同一プロセスが localhost の `PORT+1` で配信する。ブラウザを別コンテナで動かす場合は、ソース側の `createStaticServer` を localhost で起動し `ASSET_PORT` を指定する。`UPSTREAM` は検証する配備版のHTTP読取先（Pod等）を指定する任意設定。APIは常にモックする。配備版のHTML/JSを `SITE` へ取得する方法でもよい。サービスワーカーは無効にする。

PC・スマホ縦横でメニューとURLカードの開閉、メニュー表示中の新返答後の閉鎖、Escape、トグル、本文、独立した外側操作と新返答を確認する。スマホの外側操作は `touchscreen.tap`。新返答ごとの番号と無音演技の終了を待ち、送信待ちや古い本文を誤認しない。表示状態と吹き出しの実際の可視性を両方確認する。

Lean生成の長さ3の64列から実画面で実行可能な4列を選び、各操作直後も照合する。残りを恒等操作の `overlay` で埋めた生成列の結果を途中の期待値として使う。旧版の失敗先行検証だけは `SKIP_MODEL=1` で操作不能となるモデル列を省ける。結果JSONと画像を出力する。実機Safari、実BFF、実音声と同時入力は対象外。
