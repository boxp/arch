# BOXP-441 full-v10d

**担当自己評価: 未受入。** 後ろ髪の細い切れ目を closing した候補を出力したが、同時刻比較と BodyAngleX ±10 では縦白線と顎下の白い境界が残る。欠陥を解消したとは判定できない。Owner の受入判定ではない。

## 再構築と層別診断

v10c を固定入力・psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865` で再構築し、p2lrt SHA-256 `68cbe11bd8c3c4b4a2b6cc40ce6d3734d7c4acad772fad5b63bd1aa46479f0ff` が指定値に一致した。

[層別診断](../../web/public/kohako/live2d/compare/kohako-full-v10d-diagnosis.jpg) は v10c の待機開始約 4 秒・10 秒、および BodyAngleX -10 / +10 を停止し、同一姿勢で `drawMesh` を選別したもの。背景のみ、body、back_hair、neck、face の単独描画と各層を省いた描画を並べた。各停止時のパラメータと mesh ID は [diagnose.json](diagnose.json)。待機時刻はページ開始後の待機時間であり、他の撮影との同一姿勢を保証しない。

- +10 の右側の縦白線は body を除いても残り、back_hair を除くと目立つ線が消える。この姿勢では後ろ髪の描画が関与する。ただし単独描画と背景を見比べるだけでは、白い不透明画素と透明部からの背景露出、他層との重なりを画素単位で区別できていない。待機時の線についても同じ原因と断定できない。
- 顎下の明るい境界は body を除いても残る。neck 単独にも明るい境界があり、neck を除くと顎下に広い背景が見える。白三角や暗い角の各画素がどの層に由来するかは特定できていない。肌色の下地を追加する前に首層の色と透過を座標対応で検証する必要がある。
- 後ろ髪単独の図には欠けや分離した領域が見えるが、表示上の線と個々のテクスチャ画素の対応は未追跡。

## 修正と比較

候補は 1 案。v10c と同じ素材と body の alpha を使い、back_hair の alpha >128 の領域を 5×5 楕円 kernel で closing、完全透明だった 1,804 画素を近傍の既存髪色で埋めた。非連結断片除去、首下地延長の追加、body 縁処理は行っていない。変更範囲と効果を分離するため同時適用しなかった。

[同時刻比較](../../web/public/kohako/live2d/compare/kohako-full-v10d-before-after.jpg) は待機・考え中の 1、4、7.5、10、12.5 秒に最も近い実測フレーム。v10c と v10d の両方に顎下の明るい三角状境界が残る。待機 4・10 秒付近の右側の線も明確な解消を確認できない。撮影は独立しており同時刻でも姿勢が完全一致するとは限らない。[BodyAngleX -10 / 0 / +10](../../web/public/kohako/live2d/compare/kohako-full-v10d-body-angle.jpg) では両端に縦線が残る。顔や肩の大きな異常移動は目視で確認されないが、頂点の定量追跡は行っていない。v10c から body 画像は変更していないものの、再生成された rig 全体が同じ幾何になる保証はない。

[PC 固定ポーズ](../../web/public/kohako/live2d/compare/kohako-full-v10d-poses-pc-upper.jpg)、[Pixel 7 相当](../../web/public/kohako/live2d/compare/kohako-full-v10d-poses-pixel7-upper.jpg)、[待機 15 秒 detail](../../web/public/kohako/live2d/compare/kohako-full-v10d-natural-upper-detail.jpg)、[考え中 15 秒 detail](../../web/public/kohako/live2d/compare/kohako-full-v10d-thinking-upper-detail.jpg)。各動作は約 0.5 秒間隔の 31 枚で、最終実測はそれぞれ 15.000、15.001 秒。全フレームの保証ではない。

## 出力と残件

- v10d p2lrt SHA-256 `30f8a9663b0691a7781ad364d1216479a4f88dedbfcb3fede21face512915eea`。Studio に未受入候補として追加。LATEST は `kohako-v45` のまま。
- Chromium / SwiftShader の固定ポーズ・待機・考え中で pageerror なし。`npm run typecheck`、`npm test`（4 files / 30 tests）、`npm run build` 成功。実機 GPU と Owner 評価は未実施。
- 残件は右縦線の画素・層対応の確定、顎下の肌色下地と暗い角の検証、後ろ髪の大きな欠け・非連結断片、BodyAngleX の線、実機確認。画像生成、外部画像 API、Core 取得、push / PR / merge / 配備は行っていない。
