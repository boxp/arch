# kohako-full-v3 試作

原画の SHA-256 を検証した上でローカル処理する。画像生成や公式 Cubism Core は使わない。再現には Docker と指定 psd2live checkout、Gradle キャッシュを用意する。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v3/build.sh
```

`OUT/layout` と `OUT/out` は再生成時に消去される。MCP は共通ロックで直列化し、ログを記録しない。生成素材の精度・未対応事項は作業報告を参照する。

素材の `layout/parts-contact.jpg` と `layout/counts.json`、MCP の操作・各ポーズの `out/*.json` / `out/poses-*.png` が出力される。目と口は原画の楕円領域と inpaint 下地を使う。髪の小成分除去と細い隙間の closing は限定的な処理で、元の輪郭や混入の完全な分離を保証しない。`seed-Idle-error.txt` と `seed-Talk-error.txt` は該当 seed に失敗した場合に残る。

比較画像は Pillow・NumPy を使い `python compare.py /path/to/full2/out /path/to/full3/out /path/to/source.jpg /path/to/comparison` で作成できる。v2 に Eye 0.15 の描画はないため、その行の v2 は Eye 0 を表示する。原画との差は描画画像を元サイズへ再標本化した RGB 平均絶対差であり、描画解像度とアラインメントの影響を含む。
