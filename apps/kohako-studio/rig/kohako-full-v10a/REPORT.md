# BOXP-441 試験 A: full-v10a

担当判定: **未受入**。p2lrt の出力と実ブラウザでの撮影は完了。画像生成・外部画像 API・公式 Cubism Core の取得は 0 回。

1. **目・口: 指定値の識別は合格。** PC 上半身の固定値 Eye 1/.5/.15/0 で開眼・半開き・閉眼が読め、Mouth 0/.5/1 の開きも区別できる。v45 と同じ値の比較では形状・切替は概ね同等に見える。半開き .5 と .15 はどちらも同じ中間層で、連続した別形状ではない。実画面上の顔は v45 より小さいため細部の視認性は同一ではない。
2. **顔周りの白い境界がないこと: 不合格。** 待機・考え中とも髪に明るい線や角状の継ぎ目が残る。首の下地を 1 回延長し顎の白い露出は軽減したが、暗い角状の境界が残る。髪・首の境界は修正済みと判断できない。
3. 原画との画風の許容は Owner 判断待ち。静的比較では目がやや大きく、肌色と線の印象が異なる。

## 実際の撮影と根拠

- [固定値: PC 上半身](../../web/public/kohako/live2d/compare/kohako-full-v10a-poses-pc-upper.jpg)、[PC 全身](../../web/public/kohako/live2d/compare/kohako-full-v10a-poses-pc-full.jpg)、[Pixel 7 相当 上半身](../../web/public/kohako/live2d/compare/kohako-full-v10a-poses-pixel7-upper.jpg)、[Pixel 7 相当 全身](../../web/public/kohako/live2d/compare/kohako-full-v10a-poses-pixel7-full.jpg)。rest、AngleX ±30、Eye 1/.5/.15/0、Mouth 0/.5/1。
- [v45 と v10a の目・口比較](../../web/public/kohako/live2d/compare/kohako-full-v10a-v45-v10a-eye-mouth.jpg)。それぞれのブラウザ描画を切り抜いたもの。大きさと構図は同一ではない。
- [待機 15 秒・上半身の顔と首](../../web/public/kohako/live2d/compare/kohako-full-v10a-natural-upper-detail.jpg)、[待機全身](../../web/public/kohako/live2d/compare/kohako-full-v10a-natural-full.jpg)、[待機上半身](../../web/public/kohako/live2d/compare/kohako-full-v10a-natural-upper.jpg)、[考え中 15 秒・顔と首](../../web/public/kohako/live2d/compare/kohako-full-v10a-thinking-upper-detail.jpg)。約 0.5 秒間隔の実測時刻付き 31 枚。連続動画全フレームの検査ではなく、短いまばたきを取り逃す可能性がある。
- 待機 0.50〜1.50 秒で画面左の髪に白い横線、9.00〜11.00 秒で左右の髪に横線・縦線が目立つ。考え中 0.50〜1.50 秒にも左髪の白線、9.00〜11.00 秒にも左右の線が見える。考え中 2.00 秒では半開き目が見える。両状態の顎下には白い三角形と暗い角状の境界が残る。肌・髪の境界に不自然な明線があるため、背景露出を完全に排除したとは言えない。
- [原画との静的比較](../../web/public/kohako/live2d/compare/kohako-full-v10a-static-original.png) は前回の合成であり、今回の rig 動作の証拠ではない。
- Chromium / SwiftShader、PC と Pixel 7 エミュレーションで各描画に pageerror なし。待機・考え中の 15 秒は各約 60 fps、Idle modifier を再生。実機 GPU、スマートフォン実機、実音声入力は未検証。撮影画像と JSON は `/home/boxp/b441work/full10a/` に保存。

## 実装・検証

- 元原画 SHA-256 `4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84`、psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865`、配備 v45 SHA-256 `27543e04b1ec69fe3bf5c72b01b8b4ae1af8468844ace78d8dc81214df4f89cd` を確認。
- v8 の 1143×2048 layout に v45 の顔・目・口・前髪・側髪の顎上を移植。指定 3 対応点の変換は scale 約 0.930、回転約 −4.9°。元の首テクスチャを上に 50px 延長する補修を 1 回実施。
- `workspace_inspect` で対象 mesh を layer ID から解決。左右 Eye は 0.135 / 0.60、切替幅 0.004、face_smile / mouth_open の不透明度キーは必須操作で成功。自動 seed の Idle / Talk は失敗したが modifier の Idle / Talk 等は作成・出力された。
- p2lrt SHA-256 `cc828608afce34f87344f466c241b501d8623716b33919f07360c3a85c247ec2`、約 5.2 MiB、export report の losses は空。
- Studio に未受入モデルとして追加。LATEST_MODEL_ID は `kohako-v45` のまま。`npm run typecheck`、`npm test`（4 files / 30 tests）、`npm run build` は成功。
- 後ろ髪追従パッチは未実施。髪の白線・分離境界、首下地の角、実機確認と Owner の画風判定が残件。push / PR / merge / 配備は行っていない。
