# BOXP-441 full-v9 予備試作報告（未完了）

判定は rejected。p2lrt と比較画像を作成したが、依頼の全要件を満たしていない。特に外周処理と原寸化の効果を個別に分離できておらず、黒背景比較、目の開口部に限定した肌補完、上まぶたへの閉眼線位置合わせは未実施。原画のデザイン変更、画像生成、外部画像 API、公式 Cubism Core 取得は行っていない。原画 SHA-256 は指定値に一致。

## 結果と制限

1. 外周: 原画の白背景接続領域に隣接する外周に限定して alpha を推定し、白の混入を除去する試行を 1 回行った。元の v8 分離マスクはほぼ二値なので alpha は観測値ではなく近傍色からの推定。白背景の [髪・腕の比較](comparison/hair-arms-crops.jpg) では明確な改善は判定できず、黒背景での検証は未実施。原寸化と同時に変更したため効果の切り分けも未実施。
2. 原寸: 出力 canvas は 1536×2752、4096×4096 アトラス 1 枚、p2lrt 8,023,716 bytes。4096 の上限に収まり書き出し成功。ただし v8 の 1143×2048 の所有マスクを拡大したもので、完全な原画解像度での分離ではない。顔・目・口には縮小画像の画素が残る。[目元比較](comparison/eyes-crops.jpg) は開眼のぼけが残り明確な改善なし。外周処理と原寸化は同時実施であり個別効果を判断できない。
3. 閉眼パッチ: 肌補完と閉眼線は v8 のまま、改善未実施。[目の連続列](comparison/eyes-sequence.jpg) に v8/v9 を示す。

静止描画の原画 RGB 平均絶対差は目 20.640→20.649、口 3.342→3.318（0–255、領域全画素、位置ずれと再標本化を含む）。[比較シート](comparison/kohako-full-v9-compare.jpg)、[口元](comparison/mouth-crops.jpg)、[全身ブラウザ](sheets/kohako-full-v9-browser-full.jpg)、[上半身ブラウザ](sheets/kohako-full-v9-browser-upper.jpg)。上半身表示倍率の追加補正は頭が切れるため不採用、構図の一致は未確定。JPEG は各 1.3 MB 以下。

## 検証

Playwright Chromium/SwiftShader、PC 1280×800 / Pixel 7 相当、全身・上半身、rest、AngleX ±30、AngleY ±20、BodyAngleX ±10、Eye 0/0.15/0.5/1、Mouth 0/0.5/1、複合を停止・固定して撮影し pageerror 0。v9 の FPS は短時間計測で約 62、実機性能の保証ではない。読み込み時間は未計測。胸像 v45 は補正試行前の固定 PNG が full8 の PC・Pixel 両方とバイト一致。追加倍率補正は取り消した。メモリは共有 cgroup 上限 4 GiB、ビルド中 OOM なし。プロセス単位の最大値は未計測。

p2lrt SHA-256 `1da4449fc5eee630ed291ec62a71a088653c9e319f4aee81faa43f3f3c3e1157`。実ブラウザで clip ID m16 Shake、m17 Idle、m18 Blink、m19 Talk を確認。seed Idle と Talk は失敗。LATEST_MODEL_ID は kohako-v45 のまま。Web の tsc、vitest 30 件、build 成功。再現手順は rig/kohako-full-v9/README.md。codex-review と codex-review-file は利用可能なスキルとローカルで見つからず、手動確認。

残件: 原画上の境界再分離、外周補正のみ・原寸化のみの独立比較、黒背景の拡大検証、開口部限定の肌補完と閉眼線の位置合わせ、構図の一致と読み込み時間・プロセス単位メモリの測定。push・PR・merge・配備は未実施。
