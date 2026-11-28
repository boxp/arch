# realpath749.mjs（BOXP-749）

`realpath749.mjs` は実 BFF の build（conversation/extractViews/geocode）に Hermes の応答だけ合成文を通し、実 Nominatim で Cafe Renoir 芝大門店（本人画面でピンが出なかった時と同じ形・aliases あり）と、同店・エクセルシオール カフェ 三田店・ロバーツコーヒー 麻布十番店の複数候補の位置を引く。`node realpath749.mjs <bff/dist の絶対パス> > real749.json`。

`map749.mjs` はその出力を BFF モックの返答に入れ、PC・Pixel 7 縦/横で家の視覚領域に OSM タイルと番号・店名付きピンが出ること、丁目だけ分かる時は点線の範囲（ピンではない）、位置不明の候補は印なしで一覧に残ること、地図タイル以外の外部通信が無いことを確かめる。Playwright 1.56.1 で `SITE`（既定 `/site`）の `kohako/` にビルドを置き、`node map749.mjs real749.json /out`。結果は `result.json` とスクリーンショット、失敗時は終了コード 1。
