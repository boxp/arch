# BOXP-470: kohako-full-v11m

本人当面受入済みの全身 v11l を基準に、手首の隙間と状態別の表情を生成なしで改善した版。顔配置（v11g）・髪の動き（v37）・口（v45 由来）は変更していない。画像生成、Gemini、外部画像 API は使っていない。

## 手順

`rig/kohako-full-v11l` の出力 layout のコピーに `prepare_v11m.py` を適用（`LAYOUT`、`ART`=kohako-full-art-v0 の JPEG）し、`build.sh` に渡す。出力 p2lrt の SHA-256: `80225e93d38b77d5a76af9287bee8c8c541417b8a55eec228a0e1a7b5b389073`。`seed-Idle` / `seed-Talk` の失敗は v11g 以降と同じ扱い。

## 原因と修正

- **手首の隙間**: 層単独の描画で特定した。`hand_right` / `hand_left` の手首部分が y≈950 で直線に切り抜かれており、静止時はこの開口を `back_hair` に焼き込まれた暗い穴埋めの塊が隠していただけだった。体を回すと手と後ろ髪が別々に動くため、背景の隙間と浮いた塊が見えていた。`prepare_v11m.py` は開口を原画の画素で埋め（左右 606 / 686 画素）、手で隠れる範囲の塊を `back_hair` から除去する（1290 / 1263 画素）。手の横の髪先は残す。
- **表情**: 標準の表情は目を `smile`×0.75 / `sad`×0.85 / `angry`×0.9 で細める。全開と半眼の切替が 0.975 にあるため、発話中ずっと半眼になっていた（v11j で `noExpressions` にした原因）。また `ParamCheek` は口元に白い斑を出す。`build.py` で全表情を `expression_put` により置き換え、眉・口の形・視線だけにした（`surprised` は開口 0.25 を含む）。`think` を追加し、考え中はこれを使う。v11m は `noExpressions` を外している。

## 確認（実 Chromium / SwiftShader）

- `compare/kohako-full-v11m-hands.jpg`: 同一パラメータ（静止、体 ±5、±10）の v11l / v11m。v11l の穴と浮いた塊は消えた。体 ±10 の衣装パネルと袖の周りの別の隙間は残る（通常動作は ±3.5 度）。
- `compare/kohako-full-v11m-expr.jpg`: 6 状態の v11l / v11m。眉と口の形で状態差が出る。差は控えめで、目は変わらない。
- `compare/kohako-full-v11m-mouth.jpg`: 開口 0〜1 と発話表情。口の形は v11l と同じ。
- `compare/kohako-full-v11m-pair.mp4` / `-face.mp4`: 自然動作 23 秒の同時刻比較（左 v11l / 右 v11m）。発話中の EyeOpen の分布は v11l と同じ（半眼帯 v11l 31/324 フレーム、v11m 31/325 フレーム。まばたき分のみ）。
- 静止の v11l / v11m の差分は手首周辺に限られ、それ以外は輪郭の微小な差のみ。

## 未確認

実機 GPU と本人ブラウザでの見え方（SwiftShader のソフト描画のみで確認）。本人の美術評価。実 Hermes 会話での状態別表情は配備後に確認する。
