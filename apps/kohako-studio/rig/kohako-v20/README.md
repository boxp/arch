# v20（生成素材を不採用）

閉口素材と新しい半開き素材の唇線の曲率が一致せず歯状の白い部分もあるため、半開き層は差し替えない。`rebuild.sh` は v17 を再構築して v20 にコピーする。v20 は比較画像だけを Web に掲載する。

`uv run --with pillow python apps/kohako-studio/rig/kohako-v20/make_compare.py WORK_DIR OUTPUT_DIR` で、再構築の v17 キャプチャを使って原画 / v17 / 最終 v20（v17 と同一）の比較を生成する。静止描画であり物理シミュレーションを含まない。素材画像の比較には生成素材を使用する。
素材比較は `uv run --with pillow python apps/kohako-studio/rig/kohako-v20/material.py VAULT OUTPUT.jpg` で生成できる。3素材は元の同寸法のため同じ座標で切り出しており、ECC 位置合わせは行っていない。
