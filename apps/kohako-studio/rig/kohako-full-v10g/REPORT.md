# BOXP-441 full-v10g

**担当評価: 不採用・未受入。** v36 anchor パッチを適用した psd2live で再生成したが、生成 p2lrt は v10e と完全一致した。隙間を改善できていない。Studio には比較用として掲載する。Owner の受入判定ではない。

v10f を指定手順で再構築し SHA-256 `da851618bea569f4d95f6df6dbd4d010fe2fcddcdce53b72d2058adb5bc60838` に一致。土台 v10e の既存処理は体層の頭周辺の髪 5,446 画素を後ろ髪へ移動済み。今回の 1 案はその状態に v36 `backhair-anchor.patch` を適用し、FX=15、FY=-6、肩 y=455 を指定した。全身 1143×2048 layout の face 矩形は y=206〜402、体上端 y=390、腕上端 y=427。顎の代用は face 下端 y=402、肩終端 y=455 は肩領域の概算であり厳密な測定ではない。パッチは faceFrame.bottom を顎に用いる。

結果の p2lrt SHA-256 は `105d2c4d6e1908dbd68c23743b65b718b96d0efb761a6524dbb820bb24264630` で v10e と完全一致。パッチのコンパイルは成功したが、生成結果に差がない原因は未特定。有効条件・環境変数の伝播・生成時の実行コードを追加調査する必要がある。純粋な B1 と B2 の分離や B3 の patch_body は未実施。

419×555 stage の頭部矩形 x=96〜321、y=24〜216 内の純マゼンタ近傍画素（R,B>245、G<10）。通常の外側背景を多く含み、隙間そのものの面積ではない。各位置は作業ディレクトリの `counts.json` に画面座標で保存。v10e / v10g は同数かつ同位置。

| 姿勢 | v10e | v10g |
|---|---:|---:|
| idle4 | 17599 | 17599 |
| idle10 | 16854 | 16854 |
| BodyAngleX −10 | 18483 | 18483 |
| BodyAngleX +10 | 18517 | 18517 |
| AngleX −20 | 18160 | 18160 |
| AngleX +20 | 18231 | 18231 |
| AngleZ −10 | 18445 | 18445 |
| AngleZ +10 | 18274 | 18274 |
| 静止 | 18184 | 18184 |

静止 RGB 差分は 0 / 232,545 画素。[固定姿勢](../../web/public/kohako/live2d/compare/kohako-full-v10g-background.jpg)、[静止差分](../../web/public/kohako/live2d/compare/kohako-full-v10g-rest-difference.png)、[待機 15 秒](../../web/public/kohako/live2d/compare/kohako-full-v10g-natural-detail.jpg)、[考え中 15 秒](../../web/public/kohako/live2d/compare/kohako-full-v10g-thinking-detail.jpg)。各 detail は 31 枚、約 0.5 秒間隔で v10e と並列表示。撮影は独立しているため姿勢の完全一致を保証しない。

コード上は back hair follow → head container → head rotation → breath → body lean → body XY。DeformLegs は別ルートで、肩下と脚が一体となることは確認できていない。肩・脚の頂点の定量検証、実機 GPU・Owner 確認も未実施。web の typecheck、test（4 files / 30 tests）、build 成功。比較画像は各 1.5MB 以下。LATEST は kohako-v45 のまま。画像生成・外部画像 API・Core 取得・push・PR・merge・配備は行っていない。

リポジトリ指定の trivy config は trivy が環境にないため未実施。

## 追記（担当 Opus、run 20261108T044046Z）: anchor が効かなかった原因と再ビルド

v10g 初版が v10e と同一だった原因は、`build.sh` が P2L_BACKHAIR_* 環境変数を MCP サーバーにしか渡しておらず、p2lrt を書き出す `export` コンテナ（rig を再生成する）に渡していなかったこと。胸像 v36/v37 の build.sh は export 側にも渡している。export に同じ環境変数（ANCHOR=1, FX=15, FY=-6, SHOULDER_Y=455）を追加して再ビルドした。

- 新 p2lrt SHA-256 `f4080344c56850b8e8b42aa78a5276a3dbf52165ac0a58733e98cd07e27c737e`（v10e と別物）。
- 静止 RGB 差分 200 画素（v10e 比）。
- 首傾け AngleZ +10 で、v10e は左肩外側の長い髪が裂けて背景（マゼンタ）が見えていたが、v10g では髪がつながる（拡大比較 compare/kohako-full-v10g-zoom.jpg）。
- 右頬横の細い縦の隙間は v10e/v10g とも**静止時にも**見える。頭の動きで開く隙間ではなく、移植した顔・側髪の間の静止的な欠けで、別の修正が必要。
- 頭部矩形のマゼンタ画素数（外側背景を含む）: idle4 17599→17670、idle10 16854→16954、AngleX −20 18160→18298、+20 18231→18286、AngleZ −10 18445→18563、+10 18274→18360、BodyAngleX ±10 と静止は同数。数値は外側背景込みのため隙間の増減を表さず、目視比較を優先した。
- 担当評価: 首傾け時の髪の裂けは改善。右頬横の隙間が残るため未受入（比較候補）。
