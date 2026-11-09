# BOXP-441 全身 v8 試作報告

## 判定

**rejected（未受入）**。Web に全身・上半身の表示切替を追加した。モデルは v7 を基に髪外側の小さな淡色成分除去と目の肌補完マスク拡張を各 1 回試したが、静止比較および上半身の実ブラウザで明確な改善は確認できない。原画のデザイン・比率・ポーズは変更していない。画像生成・外部画像 API は 0 回、公式 Cubism Core は取得していない。LATEST_MODEL_ID は kohako-v45 のまま。

## 表示切替とブラウザ

Studio と live2d.html の全身モデルに「表示: 全身 / 上半身」を追加し、初期値は全身。`?frame=upper` と切替操作を連動する。上半身は同じモデルを 1.8 倍にして頭から腰付近を表示し、canvas の CSS 矩形×max(DPR,2) の内部解像度で描画。ResizeObserver で Studio の非表示からの表示とサイズ変更に対応する。

Playwright Chromium / SwiftShader、PC 1280×800 と Pixel 7 相当で、両ページの URL 初期値、上半身→全身→上半身と URL の変化を確認。pageerror は 0。live2d の全身 v8 は PC CSS 418.36×555 / 内部 837×1110、Pixel CSS 338×560 / 内部 888×1470。上半身も内部サイズは同じで、拡大後の表示範囲をその解像度に描く。Studio 上半身の内部寸法は PC 760×1014、Pixel 888×1183。

胸像 v45 は切替を表示せず、frame=upper でも同じ描画。固定ポーズの canvas PNG は変更前 full7 の保存画像と PC・Pixel でバイト一致。内部寸法はそれぞれ 418×560、887×1145。計測は同一 Chromium 環境内。

v7/v8 の全身・上半身構図で rest、AngleX ±30、AngleY ±20、BodyAngleX ±10、Eye 0/0.15/0.5/1、Mouth 0/0.5/1、複合を behaviors・clip を停止し setParameter で固定して撮影。PC と Pixel の横並びは `compare/kohako-full-v8-browser-full.jpg`、`...-browser-upper.jpg`。実ブラウザの clip ID は m16 Shake、m17 Idle、m18 Blink、m19 Talk（suffix `:6d6f74696f6e`）。短時間の自動動作中 FPS は PC v7 全身/上半身 58.6/60.3、v8 61.3/60.9、Pixel v7 61.6/60.6、v8 61.8/61.3。SwiftShader の参考値であり実機性能の保証ではない。

## v7 との比較と残件

- 口: 画素と keyform は v7 踏襲。上半身では全身より見やすいが、閉口線の細さと開口の不自然さは残り、モデル改善は確認できない。
- 目の開閉: 0、0.15、0.5、1 の変化は維持。閉眼端の暗い点・影と周囲の乱れが残る。肌補完の膨張を 19×19 から 21×21 にしたが、閉眼線層そのものの原画上まぶたへの位置合わせは実施できていない。
- 髪片: 髪外側の位置と淡色条件に限定して小連結成分を透明化したが、髪の白い細片・房間の明るい線は残り、明確な改善は見えない。衣装や肌を対象とした意図的な処理はしていないが、手動分離による精査が必要。
- 継ぎ目: 首振り・体回転時の肩や髪の境界が残る。体層から髪層への追加移動は未実施。
- 原画/v7/v8 の目元・口元・髪の拡大と静止ポーズは `comparison/` および Studio の比較リンクに収録。静止描画は物理シミュレーションの評価ではない。

compare.py 方式の rest 原画 RGB 平均絶対差（0–255、領域全画素）は目元 **20.111 → 20.640**、口元 **3.347 → 3.342**。再標本化、位置ずれ、背景を含むため線単独の品質を表さない。

## 再現・検証

原画 SHA-256 `4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84`、psd2live commit `6fe868a20c7bf12586fa8ce0a05982f099faa865` を検証。p2lrt SHA-256 `e36f4637eec2d564b4e098548a044723c50a320803cb17bb2f58875504f3c391`。必須 keyform、保存、全静止ポーズ、export 成功。seed Idle は未知パラメータ、Talk は骨不足で失敗し、再生品質は未保証。再現手順は `apps/kohako-studio/rig/kohako-full-v8/README.md`。

Web の `npx tsc --noEmit`、`npx vitest run`（4 ファイル 29 件）、`npm run build` 成功。比較 JPEG は各 1.3 MB 以下。指定の codex-review / codex-review-file は利用可能な技能とローカルに見つからず、差分を手動確認。push・PR・merge・配備は未実施。
