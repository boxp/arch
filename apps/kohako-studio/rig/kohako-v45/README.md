# kohako-v45（BOXP-441・試作3を最新の試作として採用、本人の美術受入前）

v44 の既存半開き目素材を再利用する試作。今回の画像生成は 0 回、公式 Cubism Core・外部 API は不使用。v37 の髪、v38 の右肩、口の処理は変更しない。

## 原因と案

v44 の 0.02 幅の不透明度交差では中間フレームに灰色の重なりが出る。試作 1 は幅 0.001・中心 0.11 / 0.59、試作 2 は幅 0.004・中心 0.11 / 0.59、試作 3 は幅 0.004・中心 0.135 / 0.60。交差区間の中央では半透明が残るため、任意の開度で二重像が消えることを保証しない。試作 1 では半開き全体が灰色となり、作成系の近接許容値 0.001 と最小スパン 0.0015 が影響した可能性が高い。試作 2 の通常待機でも開度 0.111 の灰色フレームを確認し不採用。試作 3 は実測値を避ける位置にずらした。15 秒の通常待機では 8 回のまばたきがあり、両目の切替区間の値は観測されなかった。ただし 0.60 の静止描画には灰色の重なりがあり、実際の描画値はフレームレートや位相で変わる。スローでは半開きと閉眼の形の段差も確認したため、安定した改善と判断できず不採用。v38 を最新に維持し、v45 は比較画像と動画のみ表示する。

配備ページの通常待機では Idle クリップと runtime の自動まばたきの両方が目を動かす。自動動作を無効化しても Idle 側のまばたきが残り、クリップを止めても自動動作側が残る。`parameterValues()` は描画後の `p2l_parameter_current` を返す。Web の `setParameter` は下位のホスト値であり、motion と behavior に後から上書きされるため、Blink クリップだけの変更や単純な入力量子化では両経路を扱えない。

## 再構築・録画

前提は v44 README と同じ WORK と素材。固定 digest の Docker イメージを使用し、MCP 18767 の共通ロックを取得、サーバーログは無効。`OUT/v29-mask.png` が必要。

```sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td45/out bash apps/kohako-studio/rig/kohako-v38/build.sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td45/out \
EYE_REF=/home/boxp/b441work/td43/refs/4-v38-eyes.png \
EYE_ASSET=/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/codex-eyes-half-v43-1.png \
bash apps/kohako-studio/rig/kohako-v44/build.sh
mkdir -p /home/boxp/b441work/td45/c/out
cp /home/boxp/b441work/td45/out/v29-mask.png /home/boxp/b441work/td45/c/out/v29-mask.png
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td45/c/out \
V45_LOW=0.135 V45_HIGH=0.60 EYE_REF=/home/boxp/b441work/td43/refs/4-v38-eyes.png \
EYE_ASSET=/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/codex-eyes-half-v43-1.png \
bash apps/kohako-studio/rig/kohako-v45/build.sh
uv run --python 3.12 --with pillow --with numpy python apps/kohako-studio/rig/kohako-v45/compare.py /home/boxp/b441work/td45/c/out/v45/out /home/boxp/b441work/work/bust29.png apps/kohako-studio/web/public/kohako/live2d/compare
mkdir -p /home/boxp/b441work/td45/c/out/v38/out
cp /home/boxp/b441work/td45/out/v38/out/kohako-v38.p2lrt /home/boxp/b441work/td45/c/out/v38/out/
OUT=/home/boxp/b441work/td45/c/out DEST=apps/kohako-studio/web/public/kohako/live2d/compare bash apps/kohako-studio/rig/kohako-v45/video.sh
```

録画は `verify/video/README.md` の b441pw 環境を使い、localhost のページを配備 Service に転送、p2lrt をローカルで差し替える。待機 15 秒、1→0→1 の 0.15 秒と同軌道の 0.75 秒、口・髪を含む決定論的軌道。シートの時刻は画面録画の時刻、パラメータは近傍の描画フレーム値なので、両者には最大数フレームのずれがあり得る。

## 評価と残件

3 案とも、同一 MCP セッションで v38 を 2 回・候補を 1 回描画。正面、X ±30、Y ±20 × 開度 0〜1 の 0.05 刻みと 0.11 / 0.59 で、canvas x=250〜560、y=130〜310 の外は 0 画素、v38 の反復も 0 画素。`kohako-v45-{pixel-diff,repeat-diff}.json` は試作 3 の結果。時刻付きフレームを左右両目で確認し、試作 2 は実際の待機で灰色の重なりが現れた。試作 3 の今回の待機・等速・スローの記録では切替区間を踏まなかったが、その偶然に依存する。口・髪を動かした比較では目立つ退行は見えなかった。別撮りのため位相差があり、動画の画素完全一致を意味しない。肌境界、目の形の連続性、異なる描画位相、本人の美術確認が残る。

- 既存素材 SHA-256 `fe53d258fba10cfe7960690a878f9d664429e4d1b3fbf520eeee650ae682f0f6`
- 再構築 v38 `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260`
- 再構築 v44 `e0612539f73ee0f299d095eb9e7d22711d49f34e84a8f9047c83c04721622389`
- 試作 1 `d9d7def46ee946d0809ee7d3ea811d248ec325f98914bb48daf3da1e22b832e2`
- 試作 2 `982c00018fa2706e725f6cfb91d114565021d2744d566477fabb208e3edd0601`
- 試作 3 `27543e04b1ec69fe3bf5c72b01b8b4ae1af8468844ace78d8dc81214df4f89cd`（配布せず作業ディレクトリに保持）

## 担当（Opus）の最終判断

Codex は上記の理由で不採用としたが、担当が待機・等速・1/5 スローの連続フレームシートを v38 と並べて目視した結果、v38 では閉じる直前・開き始めに灰色の二重像がはっきり出るのに対し、試作 3（sha `27543e04…`）では録画したどのフレームにも二重像がなく、半開き・閉眼とも原画に近い形で表示された。切替点ちょうどの開度で 1 フレームだけ薄い重なりが出る可能性と、スローでの形の段階的な切替は残るが、v38 より明確に改善しているため、固定 URL の最新の試作（`LATEST_MODEL_ID=kohako-v45`、v38 は前回版）として配備する。本人の美術受入ではない。比較動画・画像は選択欄 `v45-video` に掲載。
