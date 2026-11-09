# kohako-full-v8 試作

v7 起点。外側の髪領域にある小さな淡色連結成分の背景除去と、目の肌補完マスクを 19×19 から 21×21 に広げる試行。画像生成と公式 Cubism Core は使用しない。美術評価と残件は REPORT を参照。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v8/build.sh
```

入力 SHA と psd2live commit を検証し、OUT/layout と OUT/out を再生成する。MCP は共通 flock、固有コンテナ名、終了時 cleanup を使う。必須 keyform、保存、静止ポーズおよび export の失敗は中断する。`compare.py V7/out V8/out SOURCE comparison` で原画差と静止比較を生成する。`browser.cjs` は `/tmp/dist` と `/tmp/node_modules` を使い、固定ポーズの両構図を撮影する。`browser-sheet.py CAPTURES OUTPUT` で PC の比較 JPEG を作る。原画差は位置ずれと再標本化を含み、物理動作の評価ではない。
