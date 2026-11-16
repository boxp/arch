# kohako-v27（試作）: 肩下の頂点を頭の移動と逆向きに補正（画像生成なし）

v26（v17 layout 起点・髪の肩線分割なし・v25 と同じ口/目/髪飾りの処理）の上で、
後髪・前髪L/R の肩線より下（rest canvas y≥315、20px 帯ごと）の頂点を、`ParamAngleX`/`ParamAngleY` ±30 のときの
変形後位置と rest の差（残差）の逆向きへ smoothstep（y315〜395）で移動するキーを `author_axis` で付けた第3案。
配備している `kohako-v27.p2lrt` の SHA-256 は `47fcdefbcb6bd3b3885da55348897379031a4abee571d71ea9a0e21c67d1ca43`。

## 再現について（未完）

- `measure27.py`: 各ポーズの変形後頂点を取得する。`debug_mesh_points` は psd2live 6fe868a の隔離コピーに
  診断用に追加した読取専用ツール（`CpuDeformationEvaluator` の world position、Y 符号反転）で、上流にはない。
  その出力が `measure27.jsonl`（第3案の入力）。
- `candidate27c.py`: 上記の残差から補正キーを作り `/tmp/boxp441/v27c/out/kohako-v6.psd2live` に保存する。
  補正量の倍率 250 は実験値で、`translate.delta` の px 換算は未確定（vault `live2d/kohako-v27-report.md`）。
- `rebuild.sh` にはまだ組み込んでいない（診断ツールの追加が必要なため）。p2lrt はこの実験成果をそのまま配備している。

## 評価（2026-11-07）

- 決定論軌道（X±30・複合 X±30/Y±20）の静止比較・録画では、複合ポーズで肩下の平均残差が前髪L/R で約 10〜12px 残り、
  当初は不採用と判断した。
- 実際の Web の動き（behaviors 有効、考え中の首振りは視線 0.3 倍で X 約 15°・Y 約 7° まで）を同じ配備ページで録画すると
  （`verify/video/run.sh` に `OVERRIDE_P2LRT` を指定して v25 と同位相）、v25 で出る右肩外側の髪の段差が目立たなくなった。
  左肩外側の細い白い筋、複合 ±30° の段差は残る。このため「自然動作の範囲で改善した試作」として固定 URL の最新に置く（本人の美術受入前）。
