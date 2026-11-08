# BOXP-441 full-v10c

**担当自己評価: 未受入。** 保存済み診断姿勢と待機・考え中の比較時刻で、v10a の太い横白帯は v10c では見えない。ただし顎下の白い三角・暗い境界と、BodyAngleX の端での縦白線が残る。後ろ髪の欠けの完全な補修もできていない。Owner の受入判定ではない。

## 画素と層の診断

[v10b 診断パラメータを再適用した層別画像](../../web/public/kohako/live2d/compare/kohako-full-v10c-diagnosis.jpg) は v10a / v10c 各々の全層、body のみ、後ろ髪のみ、body なし。値は [diagnose.json](diagnose.json)。元の v10b 診断は約 1 秒の v10a の状態を停止したもので、本図はその保存値を再適用した固定姿勢。元の body 画像の左上 76×65 px を拡大した [RGBA・alpha・白画素の図](../../web/public/kohako/live2d/compare/kohako-full-v10c-body-pixels.png) では、細い白線上に RGB 各成分 >225、alpha=255 の画素が 35 個存在し、同条件の部分透明画素は 0 個。これは不透明白画素が存在する実測であり、透明縁サンプリングだけが候補とは言えない。

ただし画面上の横白帯と画像上の画素の対応をテクスチャ座標ごとに追跡していない。今回の候補では髪の移動と白画素除去を同時に行いメッシュ形状も変わるため、**(a) 不透明白画素が原因と確定はできず、(b) サンプリングの寄与も否定できない**。白画素のみを変更する対照実験が残る。body なしでも顎下の白形が残ることから、白帯と同じ原因だとは扱わない。

## 修正と比較

候補は 1 案。v10a を基に v37 の方法を全身用座標へ適用し、body の上端外側で暗色の髪 5,446 画素を同座標で back_hair に合成して body から除去した。上端外側の RGB 各成分 >225 の 38 画素も除去。首は v10a の既存下地延長を使用したが、顎下の白三角は解消せず、今回の後ろ髪に追加の下地や closing は行っていない。透明縁の系統的な処理も未実施。結果は限定的で、これらは残件である。

[同時刻比較](../../web/public/kohako/live2d/compare/kohako-full-v10c-before-after.jpg) は待機・考え中それぞれ 1、4、7.5、10、12.5 秒に最も近い実測フレーム。v10a に見える左の太い横帯や右の短い横線は、比較した v10c フレームでは見えない。独立撮影のため姿勢は完全一致しない。v10c 待機は最後 15.049 秒、考え中は 15.000 秒。

[BodyAngleX -10 / 0 / +10 比較](../../web/public/kohako/live2d/compare/kohako-full-v10c-body-angle.jpg) では顔の大きな異常移動は視認されないが、端の姿勢で縦白線が残る。定量的な頂点追跡や実機確認は未実施。[PC 固定ポーズ](../../web/public/kohako/live2d/compare/kohako-full-v10c-poses-pc-upper.jpg)、[Pixel 7 相当](../../web/public/kohako/live2d/compare/kohako-full-v10c-poses-pixel7-upper.jpg)、[待機 detail](../../web/public/kohako/live2d/compare/kohako-full-v10c-natural-upper-detail.jpg)、[考え中 detail](../../web/public/kohako/live2d/compare/kohako-full-v10c-thinking-upper-detail.jpg)。各動作は約 0.5 秒ごと 31 フレームであり全フレームの保証ではない。

## ビルドと残件

- p2lrt SHA-256 `68cbe11bd8c3c4b4a2b6cc40ce6d3734d7c4acad772fad5b63bd1aa46479f0ff`。psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865`。画像生成、外部画像 API、Core 取得なし。
- Studio に未受入候補として追加、LATEST は `kohako-v45` のまま。Chromium / SwiftShader で固定ポーズ・待機・考え中の pageerror なし。
- `npm run typecheck`、`npm test`（4 files / 30 tests）、`npm run build` 成功。
- 残件: 白画素単独対照による原因確定、後ろ髪の欠けを埋める下地・closing、顎下の白三角と暗い角の補修、BodyAngleX 端の縦白線、実機 GPU と Owner による評価。push / PR / merge / 配備なし。
