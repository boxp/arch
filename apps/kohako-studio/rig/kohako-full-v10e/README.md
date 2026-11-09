# BOXP-441 full-v10e

v10d と同じ入力から、neck の上部にある透明な隙間のみを補修する候補。`build.sh` の入力は v10a README を参照。画像生成・Core の取得は不要。撮影と判定は [REPORT.md](REPORT.md)。

`diagnose.cjs` は v10d の保存済み `diagnose.json` を `/tmp/params.json` として渡し、固定パラメータで描画する。CSS 背景とページ背景をマゼンタ／緑に変更し、WebGL は透明 clear のまま合成する。`geometry.cjs` は bodyplus の変形後／ニュートラルの頂点と UV を出力する。`map.py` は今回のスクリーン画素に対して三角形の被覆を調べる検証スクリプトで、入力パスは作業ディレクトリに固定されている。元画像への位置はニュートラル頂点から推定するため、精密な atlas 逆対応を保証しない。
