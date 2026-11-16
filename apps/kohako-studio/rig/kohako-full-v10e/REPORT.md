# BOXP-441 full-v10e

**担当自己評価: 未受入。** 首の隙間を埋めた候補を出力した。固定姿勢で顎下の背景露出は軽減したが、髪の縦の露出は残る。Owner の受入判定ではない。

## 背景と画素の診断

v10d を指定入力と psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865` で再構築し、SHA-256 `30f8a9663b0691a7781ad364d1216479a4f88dedbfcb3fede21face512915eea` に一致。v10d の保存済み idle4、idle10、BodyAngleX −10/+10 の全パラメータを再適用し、停止して同じ姿勢を描いた。[背景色と層別](../../web/public/kohako/live2d/compare/kohako-full-v10e-diagnosis.png)、[v10d / v10e のマゼンタ・緑比較](../../web/public/kohako/live2d/compare/kohako-full-v10e-background.jpg)。WebGL は透明 clear、canvas とページ背景を変更して合成した。色の追従は白い不透明画素ではなく背景の寄与を示すが、すべての白い縁を説明するものではない。

| 部位・姿勢 | v10d 画面座標 (stage CSS px) | マゼンタ背景 RGB | 緑背景 RGB | メッシュ／画像への対応 |
|---|---:|---|---|---|
| 右側の縦線、BodyAngleX +10 | (284,150) | (255,0,255) | (0,255,0) | この点は back_hair、neck、body、face のいずれの三角形にも含まれず、対象画素の UV・RGBA は存在せず逆対応不能。背景露出。 |
| 顎下、BodyAngleX +10 | (223,179) | (255,0,255) | (0,255,0) | neck、back_hair、body の三角形外。face の atlas UV は約 (0.669312,0.048264) だが、ニュートラル頂点を使った逆写像は face 画像の境界外 (88,196) となり RGBA を特定できない。背景露出。 |
| 首の補修範囲例（画面点との対応は未確定） | neck PNG (83,53) | — | — | v10d RGBA (69,58,73,0)、v10e (10,71,85,255)。画像左上原点。 |

画面画素は 419×555 に丸めた stage スクリーンショットでの座標。三角形検査はスクリーン画素中心を変形後のメッシュに逆投影した。`geometry.json` / `geometry.cjs` / `map.py` に取得と計算を残す。ニュートラル姿勢の頂点による画像座標は近似であり、atlas から layer PNG への厳密な対応やフィルタ寄与は未解明。上表の首 PNG 画素は変更例であり、顎下画面点と同じ画素と断定しない。画面点がメッシュ外の場合、存在しない UV や RGBA を推測していない。

## 修正と比較

候補は 1 案。v10d の neck で alpha >128 のマスクを 3×31 の closing にかけ、上部 y=50〜71 の完全透明 1,511 画素を最近傍の既存色と alpha で補った。既存の首の上方延長と合わせて顎の背後を覆う。body、back_hair、face、side hair は変更していない。首画像には衣装の線も含まれるため、補間色が肌色とは限らない。

[同時刻比較](../../web/public/kohako/live2d/compare/kohako-full-v10e-before-after.jpg)、[BodyAngleX −10 / 0 / +10](../../web/public/kohako/live2d/compare/kohako-full-v10e-body-angle.jpg)、[PC 固定ポーズ](../../web/public/kohako/live2d/compare/kohako-full-v10e-poses-pc-upper.jpg)、[Pixel 7 相当](../../web/public/kohako/live2d/compare/kohako-full-v10e-poses-pixel7-upper.jpg)、[待機 detail](../../web/public/kohako/live2d/compare/kohako-full-v10e-natural-upper-detail.jpg)、[考え中 detail](../../web/public/kohako/live2d/compare/kohako-full-v10e-thinking-upper-detail.jpg)。15 秒は約 0.5 秒間隔の各 31 フレーム、最後の実測は各 15.001 秒。同時刻比較の撮影は独立しており、姿勢の完全一致は保証しない。色背景比較は保存パラメータを適用した固定姿勢。

顎下は色背景比較の 4 姿勢で露出が減ったが、髪脇の縦線は残る。BodyAngleX 比較で肩の明らかな異常移動は目視されず、body PNG の SHA-256 は両版とも `605a437215876481f319070ee32844cb65f1f18052466c53f4325911a6793212`。ただし再生成後の肩頂点や推定値は定量比較しておらず、副作用なしとは断定できない。

## 出力・検証・残件

- p2lrt SHA-256 `105d2c4d6e1908dbd68c23743b65b718b96d0efb761a6524dbb820bb24264630`。Studio に未受入候補として追加。LATEST は `kohako-v45` のまま。
- Chromium / SwiftShader の固定ポーズ・待機・考え中で pageerror なし。`npm run typecheck`、`npm test`（4 files / 30 tests）、`npm run build` 成功。実機 GPU と Owner 評価は未実施。
- 残件: 右側縦線に対する後ろ髪下地の補修、変形時の atlas と元層画像の厳密な画素対応、首の補間色の妥当性と全フレーム、肩頂点の定量比較、実機確認。画像生成、外部画像 API、Core 取得、push / PR / merge / 配備は行っていない。
