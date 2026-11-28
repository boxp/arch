# BOXP-749: コハコの家の地図で単一ピンを復旧し、複数候補の店名付きピンを表示する

## 原因（実 Nominatim で再現）
- 「東京都港区芝大門2-3-1 常泉ビル2F」は 0 件 → 丁目「東京都港区芝大門二丁目」（place_rank 22）＝範囲（area）。
- 名称「Cafe Renoir 芝大門店」は 0 件（OSM 上は「ルノアール」など）。
- 家は範囲の時に OSM 埋め込みへ marker を付けないため、ピンが 0 本になった。
- OSM 公式の埋め込み（export/embed.html）は marker 1 つだけで、複数候補のピンは出せない。

## 方針
- BFF: 住所で範囲が分かったら、名称 → 支店名（末尾「〜店」）を除いた名称 → aliases の順に、その範囲内に限定（viewbox+bounded）して検索し、点の一致なら正確なピン。住所が無い時は名称だけ（別店舗を避ける）。
- `kohako-view` の地図に `places`（2〜5件）と `aliases`（3件まで）を追加。モデルが座標を書いたブロックは受け付けない。位置検索の期限は呼び出しから 60 秒の絶対時刻（BOXP-751 案A。優先順位: 返答を待たせない＞未確認の位置に印を立てない＞期限内に確認できた分だけ印。混雑・遅延時の印欠けは仕様どおり）。
- 家: OSM タイル（tile.openstreetmap.org、キー・契約不要）を並べる自前描画に切替え、正確な候補は番号・店名付きピン、丁目程度の範囲は点線の枠（ピンではない）、広い範囲・位置なしは印なしで一覧に残す。ラベルは重なり・はみ出しを避ける。
- 出発地は検索にも地図にも送らない。Google マップは補助リンクのみ。

## 確認
- 単体テスト（仕様の例から期待値）: bff geocode/views、web mapview/views。
- 実 BFF build + 実 Nominatim（realpath749.mjs）で単一・複数候補の位置を取得。
- Playwright（PC・Pixel 7 縦/横）で map749.mjs と既存 viewpanel.mjs。
- merge 後、配備版で同じ確認。

仕様: Obsidian `Projects/kohako-home/map-view-spec.md`（kohako-home-map）。Lean は対象外（状態機械ではなく入出力の関数）。
