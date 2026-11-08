# BOXP-441 full-v10b

**担当判定: 未受入。** p2lrt と比較シートは出力したが、白線と顎下の境界は残る。側髪の延長だけでは解決しなかった。

## 原因の切り分け

[v10a の層別描画](../../web/public/kohako/live2d/compare/kohako-full-v10b-diagnosis.jpg) は待機開始約 1 秒の同一評価状態を停止し、`drawMesh` を省いたもの。左から全層、移植側髪なし、移植側髪のみ、v8 後ろ髪のみ、v8 body（`ArtMeshTopwear`）なし。パラメータ全値と mesh ID は [diagnose.json](diagnose.json) に保存した（AngleX 約 12.5、BodyAngleX 約 2.9 等）。

左の太い白帯は側髪を除いても残り、body を除くと消える。したがってこのフレームの帯は移植側髪の切断縁だけによるものではなく、v8 body の描画が関与する。後ろ髪単独には同じ場所に欠けがあり、body を省くと背景が現れる。白帯が body の不透明な白画素そのものか、透明縁のサンプリング等かまではこの実験で区別できていない。右の短い線や顎下の三角・暗い角にも同じ原因を一般化しない。体層画像には頭髪が残っているが、描画の分離はこの 1 状態のみである。

胸像 v29 の髪色マスク、v35 の髪内部の細い切れ目の closing、v37 の体層から頭髪を移す手法を参照した。今回 body の髪を消すと背景が露出することを確認したため、髪の下地と体層の分離を同時に検証する必要がある。

## 修正と比較

唯一の候補として v45 側髪の切断を元座標 y=345 から y=380 に変更し、約 35px 分を残した。他の層、首の補修、目口のキーは v10a と同じ。ソフトなマスク補修や body の再分離は行っていない。

[同時刻比較](../../web/public/kohako/live2d/compare/kohako-full-v10b-before-after.jpg) は待機・考え中それぞれ 1.0、4.0、7.5、10.0、12.5 秒の v10a / v10b。両者とも待機 1.0、7.5、12.5 秒に左の白帯、4.0、10.0 秒に右の線が見える。顎下の白三角と暗い角も残り、明確な改善は確認できない。独立した撮影のため同時刻でも瞬間姿勢は完全一致しない。

[待機上半身 detail](../../web/public/kohako/live2d/compare/kohako-full-v10b-natural-upper-detail.jpg)、[考え中上半身 detail](../../web/public/kohako/live2d/compare/kohako-full-v10b-thinking-upper-detail.jpg)、[PC 固定ポーズ](../../web/public/kohako/live2d/compare/kohako-full-v10b-poses-pc-upper.jpg)、[Pixel 7 相当固定ポーズ](../../web/public/kohako/live2d/compare/kohako-full-v10b-poses-pixel7-upper.jpg)。各 31 枚、約 0.5 秒間隔。待機撮影の終盤は負荷で遅れ、最後は実測 15.84 秒；シートの時刻は実測値。全フレームの保証ではない。撮影データは `/home/boxp/b441work/full10b`。

## ビルド・残件

- p2lrt SHA-256 `d00eb5e03e575526c366328322e07349cb6ba13ae04051eb7b3ed3d8b0f4ce33`。psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865`。画像生成・外部画像 API・Core 取得は使用していない。
- Chromium / SwiftShader の固定ポーズ、待機・考え中で pageerror なし。実機 GPU や実音声は未検証。Studio に未受入として追加し、LATEST は `kohako-v45` のまま。
- `npm run typecheck`、`npm test`（4 files / 30 tests）、`npm run build` 成功。
- 残件: body の髪と透明縁の切り分け、後ろ髪の欠けを覆う下地、右側と顎下の個別診断、修正後の再撮影、実機と Owner による画風確認。push / PR / merge / 配備は行っていない。
