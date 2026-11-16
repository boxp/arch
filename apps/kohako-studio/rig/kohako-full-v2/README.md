# kohako-full-v2 試作

原画の SHA-256 を検証した上でローカル処理する。画像生成や公式 Cubism Core は使わない。再現には Docker と指定 psd2live checkout、Gradle キャッシュを用意する。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v2/build.sh
```

`OUT/layout` と `OUT/out` は再生成時に消去される。MCP は共通ロックで直列化し、ログを記録しない。生成素材の精度・未対応事項は作業報告を参照する。

素材の `layout/parts-contact.jpg` と `layout/counts.json`、MCP の操作・各ポーズの `out/*.json` / `out/poses-*.png` が出力される。モデルは非生成の色分離と局所補完による試作であり、目元の色差・髪と衣装の混入などを残す。`seed-Idle-error.txt` と `seed-Talk-error.txt` は該当 seed に失敗した場合に残る。

比較画像は Pillow を使い `python compare.py /path/to/full1/out /path/to/full2/out /path/to/comparison` で作成できる。v1 は EyeOpen=1 の明示描画がないため rest をその比較に用いる。
