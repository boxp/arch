# BOXP-441 full-v10c

v10a を基にした既存画像のみの分離試験。body 上端外側の暗色髪を同座標で back_hair に移し、上端の白画素を除去する。未受入、制約と結果は [REPORT.md](REPORT.md)。

ビルドの入力と環境変数は [v10a](../kohako-full-v10a/README.md) と同じ。`diagnose.cjs` は `diagnose.json` の保存パラメータを両モデルに再適用して層別に描画する。`pixels.py` は body 左上の白・alpha を図示し、`compare.py` は撮影の実測時刻に基づき比較シートを作る。
