# kohako-v42（不採用）

BOXP-441。画像生成 0 回、公式 Cubism Core 不使用。既存の生成済み「わずかに開いた口」を中間専用層として試し、最新は v38 のままにした。

## 手順

`WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td42/out` に v38 と同じ入力、`OUT/v29-mask.png` を置く。`MOUTH_ASSET` に `codex-mouth-slight-v41-1.png` を指定して `build.sh` を実行する。固定 digest の Docker イメージ、MCP 18767 の共通ロック、ログ無効の MCP サーバーを使用する。生成素材の SHA-256 は `cd191064bffe83ffa8514d7bf159f3cb67b3c0d3c5481c0d5d2ff3f9dccb58d0`。

まず v38 を構築し、同一プロセスで基準を２回描画する。ECC で原画に素材を合わせ（相関 0.988629）、閉口線の暗部を重ねた `face/detail` 層を追加し、開口メッシュの親 `DeformMouthShapeBoth` に付け替える。開口画像は v38 のまま。口開度による不透明度は閉口 0→1 / 0.04→0、中間 0→0 / 0.04→1 / 0.25→1 / 0.35→0、開口 0.04→0 / 0.25→0 / 0.35→1。`capture.py` は静止姿勢を描画、`compare.py OUT/v42/out BUST DEST` は画像と画素差 JSON を生成する（Python 3.12、Pillow・NumPy）。

## 結果

正面、X ±30、Y ±20、各 0 / 0.02 / 0.04 / 0.1 / 0.2 / 0.3 / 0.4 / 0.5 / 1 の比較を目視。0.02 は閉口と中間の線が重なり、0.3 は中間と開口の二重線・口角のずれが目立つ。0.04〜0.2 は中間口が見え、0.4〜1 は v38 の開口に戻るが、遷移品質が不足するため不採用。静止画像だけでは時系列のちらつきは確認できない。

基準の２回描画は全５姿勢・９開度で差分 0 画素。候補と基準の canvas x=300〜500, y=240〜340 以外の差分も各姿勢 0 画素。目・髪・右肩への意図的変更はない。比較画像は `web/public/kohako/live2d/compare/kohako-v42-mouth-{0..4}.jpg`。

- v38 再構築 SHA-256: `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260`
- 試作 p2lrt SHA-256: `d63dbd6012d189af01968c876de27204d50178aea5ce9596e1d6a870df511748`（compiler 3.7.0、losses `[]`）
- 残り: 上唇と口角を共通形状にした切替、遷移の動画・物理検証、v38 の目と全開口の既知課題。
