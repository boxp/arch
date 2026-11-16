# v21（生成素材を不採用）

新閉口線は中央が下がる弧で v17 半開き上唇の中央が上がる弧と合わず、口角も一致しないため統合しない。`rebuild.sh` は v17 を再構築し v21 にコピーする。Web には比較画像のみを掲載する。

`uv run --with pillow python apps/kohako-studio/rig/kohako-v21/make_compare.py WORK_DIR OUTPUT_DIR` は再構築 v17 の v19 キャプチャから原画 / v17 / 最終 v21 の比較を生成する。v21 は v17 と同一で静止描画、物理シミュレーションなし。`uv run --with pillow python apps/kohako-studio/rig/kohako-v21/material.py VAULT OUTPUT.jpg` は生成3素材を同座標・同倍率で比較する（位置合わせなし）。
