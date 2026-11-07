# kohako-v39（不採用）

画像生成 0 回、公式 Cubism Core 不使用。v38 の閉口線と開口メッシュの不透明度が 0〜0.08 で同時に変わるため、0.04 で二重線が見える。全開時の上唇にも段差がある。

## 試行と結果

- 案 A: 両方の不透明度の遷移を 0〜0.03 に短縮。0.04 の二重線は消えたが 0.02 に移り、全開時の段差も残る。採用しない。
- 案 B: 案 A に加え、`debug_mesh_points` で開口 1.0 の 11 点を実測し、上縁側の頂点 0〜4、10 を原形へ戻した。MCP は `applied: false` と返し、p2lrt の SHA-256 は案 A と同一。全開時の段差も変化せず不採用。メッシュ自体の原形への復元だけでは解決しない。`mouth39b.py` に操作を記録した。
- 案 C: 閉口線を 0〜0.01 で消し、開口を 0.01〜0.03 で表示。二重線を避ける一方、0.01 で口が完全に消え、0.015 でも薄い。上唇の段差も残るため不採用。

3 案とも口の問題を十分には解決できないため、Web の最新は v38 のまま、比較画像のみ選択欄に掲載する。目の課題も残る。比較は MCP の静止描画で、物理を含む時系列検証ではない。

## 再現

v38 と同じ入力を用意し、マスクを `OUT/v29-mask.png` に置く。固定 digest の Docker イメージとローカル MCP を使い、共通ロックで 18767 を直列化する。

```sh
mkdir -p /home/boxp/b441work/td39/out
cp /home/boxp/b441work/td28/out/v29-mask.png /home/boxp/b441work/td39/out/v29-mask.png
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td39/out ./apps/kohako-studio/rig/kohako-v39/build.sh
```

`OUT/v39/out` に案 C の p2lrt、v38 相当・案 A・案 C の口と全身の PNG、描画座標の JSON、切替詳細、頂点座標を出す。案 B は案 A の適用後に `mouth39b.py` の reset 操作を加える。比較スクリプト `compare.py` は Pillow / NumPy を使い、`/tmp/compare/out` に上記出力、`/tmp/compare/bust29.png` に原画を置いて `TARGET=after39c python compare.py` で実行する。口以外の差分数も出す。

- 案 A/B p2lrt SHA-256: `c681bb934025f9ac04549cb08d27f8e672ecd8fa7214d9138dbaa9367ffaed5f`
- 案 C p2lrt SHA-256: `0debf406e4a457879c9cd6093aca427a808547aea677e536b225e0f9d081d84d`（export losses `[]`）
- 口 8 開度 × AngleX 0/±30 の静止比較で、口元の広い矩形を除く差分は案 A/B/C とも 0 画素。口以外の層、髪の動きの設定は変更していない。
