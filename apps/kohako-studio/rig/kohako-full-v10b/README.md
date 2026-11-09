# BOXP-441 full-v10b

full-v10a の非生成の修正候補。`create_parts.py` は側髪の切断を移植元座標 y=345 から y=380 に移す。ビルド・撮影は v10a と同じ引数で `build.sh`、`browser.sh`、`sheets.py` を使用する。白線は残るため未受入。詳しくは [REPORT.md](REPORT.md)。

`diagnose.cjs` は v10a の約 1 秒のポーズで drawMesh を選択的に省く診断スクリプト。出力したパラメータは `diagnose.json`。`no-body` は body に対応する ArtMeshTopwear を省く。
