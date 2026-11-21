# retention647-touch.mjs（BOXP-647 P1 回帰）

ビルドしたWebを `BASE_URL`（既定 `http://127.0.0.1:8847`）の `/kohako/` で配信し、Playwrightを使える環境で `node retention647-touch.mjs <証跡保存先>` を実行する。必要なら `CHROMIUM` にブラウザ実行ファイルを指定する。PC/スマホ縦横で連続ふれあい後の本文・保持復元、実時間67秒後の表示、一時表示中の新返答への切替を確認する。BFFはモックし、外部通信は遮断・失敗扱いにする。連続操作を4.5秒の一時表示内に行うため、15秒の送信制限判定には `Date.now` を進める。

結果は `result.json` と画面別のPNGとして保存する。保存先はrun作業領域または `/home/boxp/verification-artifacts/BOXP-647/` 配下を指定し、Obsidian vaultには画像を保存しない。実API・音声再生・実機Safariは対象外。
