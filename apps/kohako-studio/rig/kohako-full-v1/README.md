# kohako-full-v1 試作

原画の SHA-256 を検証した上でローカル処理する。画像生成や公式 Cubism Core は使わない。再現には Docker と指定 psd2live checkout、Gradle キャッシュを用意する。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v1/build.sh
```

`OUT/layout` と `OUT/out` は再生成時に消去される。MCP は共通ロックで直列化し、ログを記録しない。生成素材の精度・未対応事項は作業報告を参照する。
