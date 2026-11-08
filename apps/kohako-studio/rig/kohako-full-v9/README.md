# kohako-full-v9 予備試作

v8 の分離マスクを原寸に拡大し、原画上で外周を推定して色の補正を試す。目の開口部だけの肌補完や上まぶたの位置合わせは未実施。顔・目・口の一部は v8 の画素を拡大しており、全面の原寸分離ではない。評価と未実施事項は作業ディレクトリの REPORT を参照。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v9/build.sh
```

入力 SHA、psd2live の commit を検証する。共通 flock、一意な Docker 名と終了時 cleanup を使う。`OUT/layout` と `OUT/out` は再生成される。必須 keyform と save、静止ポーズ、export の失敗は中断する。画像生成と公式 Cubism Core は使用しない。
