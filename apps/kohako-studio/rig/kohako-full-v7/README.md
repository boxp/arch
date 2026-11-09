# kohako-full-v7 試作

v6 の肌補完と rig を踏襲し、口線補強を除いて v5 の原画画素を使う。ミップマップは v6 で実ブラウザ比較したが、明確な改善がなく採用しない。目周辺、髪の細片と継ぎ目は未解決。画像生成・公式 Cubism Core は使用しない。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v7/build.sh
```

原画 SHA-256 と psd2live commit を検証する。`OUT/layout` と `OUT/out` は再生成時に削除される。共通 flock によるポートの直列化、一意なコンテナ名と終了時 cleanup を使用する。口 keyform、保存、静止ポーズ、export は必須。静止ポーズは物理シミュレーションの評価ではない。

Pillow と NumPy で `python compare.py FULL6/out FULL7/out SOURCE OUT/comparison` を実行する。RGB 平均絶対差は再標本化、位置ずれや背景の影響を含む。`browser.cjs` はビルド済み Web を `/tmp/dist`、Playwright を `/tmp/node_modules` に置き、v6 のみ p2l.js のテクスチャ読み込みにミップマップを追加した場合と無変更を比較する。`browser-sheet.py` は画像と JSON を `/work` に置いて顔の比較 JPEG を生成する。
