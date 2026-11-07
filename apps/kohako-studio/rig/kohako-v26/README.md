# kohako-v26（計画・未完成）: 髪の肩線分割をやめ、追従の勾配にする

TD-23 の録画検証（`verify/video/`、vault `live2d/k8s-verify/td23/`）で、v23〜v25 の髪の違和感の実体は
**肩線（canvas y 365〜425）でのハードな分割**と分かった。上半分だけが頭に追従し下半分が体に残るため、
X=±20〜30（決定論）でも「考え中」（X 約 14〜21°）でも、外側の髪の輪郭に段差・折れ、三つ編みの折れ、
上部が離れた側で下部の髪の縁が体の横にはみ出す。v17 は逆に髪全体が頭と一緒に動いて体から外れていた。

## 方針（画像生成なし）

1. `create_parts.py`: v17 の layout（分割前の一体の髪）を起点に、v25 と同じ口・目・髪飾りの処理
   （`mouth_half` を外す、`mouth_closed`→`face_smile`、`kohako-v25/orn_fix.py`）を適用する。実装済み。
2. 生成は v25 と同じ連鎖（`kohako-v6/build.py` → `kohako-v25/eyes.py` → `kohako-v25/mouth.py`）。
3. **`hair.py`（未実装）**: `hair_back` / `hair_side_left` / `hair_side_right` のメッシュに対し psd2live MCP の
   `author_axis`（内部は `keyform_apply` seed → `rig_deform`）で、`ParamAngleX`（値 30、`mirror: true`）と
   `ParamAngleY` に **肩線以下の頂点を頭の移動量と逆向きに平行移動する**キーを付ける。
   - 頂点は `mesh_get_topology`（`[index, x, y]` はメッシュ自身の rest 空間）で y ≥ 肩線のものを `selection.indices` に、
     `soft_radius`（正規化枠、0.15〜0.25 程度＝約 100px）と `falloff: smooth` で肩線の上へ向かって重みを 1→0 に落とす
     （`src/main/kotlin/io/github/psd2live/core/RigGeometryTools.kt` の `soft()`：選択点は重み 1、周囲は最近傍選択点までの距離で減衰）。
   - `translate.delta` はメッシュ bbox 比の正規化値（`nx += delta[0] * bounds.w`）。頭の移動量 d は、髪レイヤー単独の
     `view_render_poses`（{} と {ParamAngleX: 30}）で肩線付近の行の重心差から測り、1 回目の適用後の残差で補正する。
   - `DeformHairBackFollow` は平行移動だけでなく HairRoll（顎より下を頭の支点で逆回転）を含むので、完全一致ではなく
     「肩線以下の残差が数 px 以内」を目標にする。
4. 物理（`ParamHairBack`）は v17 と同じく髪全体に掛かる。毛先が体の上で揺れるのは自然な範囲か、
   同じ決定論軌道（`verify/video/run.sh <model> det`）で録画して旧版と同位相比較して判断する。
5. rebuild.sh への組込みは v25 の後に `v17/layout` から開始する（v23 の分割を経由しない）。

## 隔離環境の再開

`rebuild.sh` は終了時に MCP server と volume を消すが、実験用には
`sed -e 's#^trap cleanup EXIT#:#'` した写しで実行すると `boxp441f-mcp` / volume `boxp441f-rig` が残る
（2026-11-07 run 20261107T020032Z で `/home/boxp/b441work/rebuild-exp.sh` として実行）。export 後に server は停止しているので
`docker start boxp441f-mcp` で再開でき、`project_import_layout` で `/tmp/boxp441/v6/layout/layout.json` を読み直せる。
