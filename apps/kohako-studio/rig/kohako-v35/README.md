# kohako-v35: 左肩上の髪の中の点線を解消（BOXP-441 TD-25、固定 URL 最新試作）

**今回の画像生成 0 回**（髪枠は 2026-11-07 04:02Z の肩/衣装下地 1/4 のみ使用済みのまま）。公式 Cubism Core 不使用。

## 原因の切り分け
- v31〜v34（体の低 alpha ゴースト、後ろ髪の明るい画素、縁の白にじみ、透明画素の色埋め）はいずれも効果なし。
- 描画側: `verify/video/run.sh` に `OVERRIDE_P2LJS` を追加し、p2l.js のモデルテクスチャを NEAREST にしたもの、
  WebGL の antialias を切ったものを v30 と同じ動きで録画 → 点線は残った（NEAREST ではむしろ濃い）。フィルタ・ミップマップ起因ではない。
- 層の単独描画（`verify/video/hires.mjs`、各 ArtMesh の表示/非表示と三角形の重ね描き）で、点線は後ろ髪（ArtMeshBackHair）の中にあると確認。
- 原因: v29 で髪を色で切り出した際、原画で房と房の間に残っていた 1〜3px の明るい隙間（白背景）が、後ろ髪の層の中の
  透明/低 alpha の細い切れ目になっていた。髪が動くと下の暗い体の層や背景が切れ目から透け、点線として見える。

## 修正 `fix_gaps.py`（`kohako-v30/fix_body.py` の直後に実行）
hair_back / hair_side_* の不透明部（alpha≥200）に 5px の楕円で closing をかけ、新たに埋まる画素のうち外形に接しないもの
（＝房の間の細い切れ目）だけを、最も近い暗い不透明の髪画素の色・alpha 255 にする。hair_back で 1,674px、hair_side は 0px。
外形と房の先の広い隙間は変えない（中央下の房の間の先端が数 px 埋まるが体の層の後ろで見えない）。

## 再現
`WORK=<rebuild-exp work dir> OUT=<kohako-v29/mask.py の OUTDIR> kohako-v35/build.sh`（`$OUT/v35/out/kohako-v35.p2lrt` を出力）。
出力 sha256 `dced5b369577ed6e5ef455dfde33cdd2ee0992393c28f1086c7d4183118b782c`、compiler 3.7.0。

## 評価（担当）
- 配備ページで v30 と同位相に録画（nat / det、v35 は `OVERRIDE_P2LRT`、エラー 0）。
- 改善: 考え中（t≈5.6〜7.3s、X≈12〜15°）の左肩上の格子状の点線が消えた。右肩・大きな首振り全体・目口・髪飾りに退行なし。
- 残り: 首振り開始直後の肩当て左上のごく小さな白い点。大きな首振りで髪の先も一緒に動く。本人の美術受入は未。
