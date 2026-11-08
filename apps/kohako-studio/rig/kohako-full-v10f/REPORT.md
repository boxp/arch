# BOXP-441 full-v10f

**担当自己評価: 未受入。** 既存色による側髪外側の延長を 1 案試した。右頬脇の背景露出は残り、静止時も差分がある。比較用 p2lrt として掲載するが、隙間修正としては不採用。Owner の受入判定ではない。

## 再構築と診断

v10e を psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865`、固定 digest の Python/JDK で再構築し、SHA-256 `105d2c4d6e1908dbd68c23743b65b718b96d0efb761a6524dbb820bb24264630` に一致した。v10e の保存済み idle4、idle10、BodyAngleX ±10 と、AngleX ±20、静止姿勢を 419×555 の stage にマゼンタ背景で再描画した。保存済みの考え中パラメータは確認できず、考え中の固定姿勢診断は未実施。考え中 15 秒の動画相当シートは別途撮影した。

| v10e 姿勢 | 画面座標 | v10e RGB | v10f RGB | 判断 |
|---|---:|---|---|---|
| BodyAngleX +10、右頬脇 | (284,150) | 255,0,255 | 255,0,255 | 背景露出が残る。v10e の既存 geometry 診断では back_hair・neck・body・face のメッシュ外。頭追従側髪と体側の髪輪郭の間の縦線。 |
| 同姿勢、近傍 | (284,145)、(284,155) | 各 255,0,255 | 未個別測定 | 背景色。近傍点の層ごとの三角形被覆は今回未検証。 |
| idle4 / idle10 / BodyAngleX −10 / AngleX −20 / +20 | (284,150) | 各 255,0,255 | 各 255,0,255 | 背景画素。姿勢ごとにこの座標が隙間内部か外側背景かの分類は未確定。 |

背景比較は [マゼンタ固定姿勢](../../web/public/kohako/live2d/compare/kohako-full-v10f-background.jpg)。頭部を含む矩形の純マゼンタ画素数は v10e→v10f で idle4 17599→17599、idle10 16854→16858、BodyAngleX −10 18483→18487、+10 18517→18510、AngleX −20 18160→18166、+20 18231→18232。矩形には通常の外側背景が多く含まれるため、隙間面積の定量値ではない。全露出画素の列挙、考え中の層別診断、全姿勢のメッシュ被覆検証は未完了。

## 修正と比較

A 案のみ。移植された左右の `hair_side` 画像の下半分で各行の外端から最大 10 元画像 px、既存の端色を透明部分へ延長し、画像の幅・矩形を更新した。他の画像は v10e と同じ生成処理。再生成時にメッシュも変わるため、変化を画像追加部分だけとは断定できない。外側へ延ばしたこの試案は静止時に他層の後ろへ隠す設計を満たしていない。

[静止差分](../../web/public/kohako/live2d/compare/kohako-full-v10f-rest-difference.png) は同一パラメータ・マゼンタ背景の v10e と v10f の RGB 差で、419×555 のうち 891 画素が異なる。静止姿勢の見た目が不変という条件を満たさない。[BodyAngleX −10 / 0 / +10](../../web/public/kohako/live2d/compare/kohako-full-v10f-body-angle.jpg)、[待機・考え中の前後比較](../../web/public/kohako/live2d/compare/kohako-full-v10f-before-after.jpg)、[固定姿勢 PC](../../web/public/kohako/live2d/compare/kohako-full-v10f-poses-pc-upper.jpg)、[Pixel 7](../../web/public/kohako/live2d/compare/kohako-full-v10f-poses-pixel7-upper.jpg)、[待機 detail](../../web/public/kohako/live2d/compare/kohako-full-v10f-natural-upper-detail.jpg)、[考え中 detail](../../web/public/kohako/live2d/compare/kohako-full-v10f-thinking-upper-detail.jpg)。15 秒は各 31 フレームで最終実測はそれぞれ 15.001 秒と 15.000 秒。同時刻比較は独立撮影のため姿勢は完全一致しない。

## 出力・検証・残件

- v10f p2lrt SHA-256 `da851618bea569f4d95f6df6dbd4d010fe2fcddcdce53b72d2058adb5bc60838`。Studio に未受入の比較候補として追加、LATEST は kohako-v45。
- Chromium / SwiftShader 撮影で pageerror なし。web の typecheck、test（4 files / 30 tests）、build 成功。
- 隙間の根治、静止時に隠れる下地、考え中の保存姿勢と露出画素の層別同定、v36/v37 の backhair-anchor を全身用に調整した案、全姿勢および実機 GPU の確認は未実施。画像生成・外部画像 API・Core 取得・push・PR・merge・配備は行っていない。
