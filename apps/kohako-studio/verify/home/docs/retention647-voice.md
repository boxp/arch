# retention647-voice.mjs（BOXP-647）

`SITE` にビルドを `kohako/` として配置した親ディレクトリを指定し、`node retention647-voice.mjs <証跡保存先>` で実行する。Playwright 1.56.1 が必要。PC・スマホで音声 API の 503 と端末音声の error を模擬し、実時間 67 秒後の本文表示、続きからの再試行、次の返答への切替と遅延 callback を確認する。BFF と音声はモックし、外部通信は遮断して失敗扱いとする。結果は JSON と PNG に保存する。実機や実音声の品質は対象外。

必要に応じて CHROMIUM に実行ファイル、または CDP に接続先を指定できる。遅延 callback の確認は端末音声のケースで行う。

音声エラーは本文の後に表示し、独立したエラーパネルで本文が覆われないことも hit test で確認する。保存先はrun作業領域か `/home/boxp/verification-artifacts/BOXP-647/` 配下とし、Obsidian vaultには画像を保存しない。
