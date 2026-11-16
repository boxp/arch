# kohako-v33（不採用・比較のみ）

v30 の「左肩上の髪の中の点線」対策。v29 で白背景から切り出した後ろ髪・三つ編みの縁に、白っぽい半透明画素が残っていた
(hair_back 743 / hair_side_left 96 / hair_side_right 72 画素)。`fix_fringe.py` はその縁の無彩色の明るい画素だけを、
最も近い暗い髪画素の色に置き換える（alpha・外形は変更しない）。v30 の `fix_body.py` の直後に実行する。

- p2lrt sha256 `2f58aa9b39bd3b12641ab04fcb16de82093b72781a009407da8aa7ecc4b10af8`、loss 0、画像生成 0。
- 評価: 層単体では外側の白い点列が消えるが、自然動作録画（考え中 X≈12〜15°）の左肩上の点線は v30 と同じ → 不採用。

実行: `WORK=... OUT=... ./build.sh`（kohako-v32/build.sh と同じ前提）。
