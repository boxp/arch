# kohako-full-v6 試作

v5 の分割・rig・口開閉 keyform を基点に、閉口線の暗い画素を 1 px 補強する。原画・公式 Cubism Core・画像生成は変更・使用しない。目の補完に使う肌色を平滑化する。目周辺と髪等の課題は残る。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v6/build.sh
```

原画 SHA-256 と psd2live commit を検証する。`OUT/layout` と `OUT/out` は再生成時に削除される。共通 flock で MCP ポートを直列化し、一意なコンテナ名と終了時 cleanup を使用する。口 keyform、保存、export は必須。静止ポーズは物理シミュレーションの評価ではない。

Pillow、NumPy 環境で `python compare.py FULL5/out FULL6/out SOURCE OUT/comparison` を実行する。原画との差は描画を再標本化した RGB 平均絶対差で、位置ずれや縮小の影響を含む。

`browser.cjs` は Playwright Chromium 用の固定ポーズ・FPS 測定スクリプトで、ビルド済み Web を `/tmp/dist`、Playwright を `/tmp/node_modules` に置いて実行する。旧倍率と現行倍率を同一モデルで比較し、各ポーズの直前に自動動作と評価段階を停止する。`browser-sheet.py` は出力画像と JSON を `/work` に置いて比較 JPEG を生成する。
