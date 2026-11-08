# BOXP-441 full-v10f

v10e を固定入力から再構築し、側髪外側を既存画素で 10px 延長した比較用試作。担当評価は未受入。詳細は [REPORT.md](REPORT.md)。

ビルドの入力・固定 digest と手順は `build.sh`、v10a README を参照。MCP コンテナのログを無効化し、Core の取得はしない。`background.cjs` は v10e 保存パラメータ (`diagnose.json`) と AngleX ±20 をマゼンタ背景で描画する。`background_sheet.py` は作業ディレクトリから固定比較シートと静止差分を作成。`browser.sh`・`sheets.py`・`compare.py` は v10e と同様の撮影・シート作成手順。
