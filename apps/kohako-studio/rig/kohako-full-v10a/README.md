# BOXP-441 full-v10a

既存 v8 layout と再構築済み v45 layout を入力とする頭部移植試験。画像生成は行わない。`create_parts.py` は v45 のタグを保ち、指定対応点の相似変換と顎より上の側髪を用いる。首の既存画素を上方へ延長して顎の下地にしている。

`build.sh` に `OUT`, `SOURCE`, `P2L`, `GRADLE_CACHE`, `BASE_LAYOUT`, `V45_LAYOUT` を指定する。psd2live は 6fe868a 固定。MCP はログ無効で起動し、一時 token を環境変数から渡す。`build.py` は mesh を layer ID で解決し、目・口の不透明度キーを必須適用する。

`browser.cjs` と `natural.cjs` は Playwright の Chromium で静止ポーズと 15 秒の待機を撮影する。`sheets.py` は撮影結果と実測時刻から比較シートを作る。結果と制約は REPORT.md を参照。

撮影は `DIST`（Studio のビルド済み dist）、`OUT`（保存先）、`NODE_MODULES`（Playwright 1.56.1 を含む node_modules）を指定して `browser.sh` を実行する。シート生成は Pillow 13 を使い、撮影先を `/work` にコピーして `python /work/sheets.py` とする。
