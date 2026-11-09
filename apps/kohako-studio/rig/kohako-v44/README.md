# kohako-v44（不採用）

BOXP-441。v38 を基準に、v43 の生成済み半開き目を再利用した試作。今回の画像生成は 0 回。公式 Cubism Core は使わない。口・髪・右肩のスクリプトは変更していない。

## v43 の原因

再ビルドした `kohako-v6.psd2live` の layer/mesh 対応と journal の不透明度キーを確認した。`eye_mid_right_v43`（画面左、`ArtMeshFaceDetail`）には `ParamEyeROpen` の 0/0.15/0.4/0.5/0.75/1 にそれぞれ 0/0/1/1/0/0 のキーがある。一方、既存の口処理が `ArtMeshFaceDetail` を固定指定するため、同じメッシュに `ParamMouthOpenY` の 0/0.08/1 → 1/0/0 も書かれていた。口を閉じた状態では口用のキーが半開きパッチに作用し、開眼時にも残った。`eye_mid_left_v43`（`ArtMeshFaceDetail2`）は `ParamEyeLOpen` に同じ開度キーを持ち、口キーは付いていない。単純な片側の目キー欠落ではない。

v44 は素材を `face_smile` の後に生成させ、`face_smile` が口処理の対象 `ArtMeshFaceDetail` となることを assert する。再ビルド後の保存データでは半開き層は `ArtMeshFaceDetail2`（L）と `ArtMeshFaceDetail3`（R）、口キーは `ArtMeshFaceDetail` のみだった。

## 候補と評価

短区間切替と変形親への接続を組み合わせた 1 案（a+b）を実施し、不採用。v43 も閉眼パッチと同じ目の変形親に接続済みなので、親接続を省いた a 単独や追加の c 案は試していない。半開きは開度 0.10/0.12/0.58/0.60 で不透明度 0/1/1/0、開眼層は 0.58/0.60 で 0/1、閉眼パッチは 0.10/0.12 で 1/0。パッチの目の中心は不透明で、肌との外周は楕円フェード。半開きが完全表示される区間は開眼層と閉眼パッチを消す。

同一 MCP プロセスで v38 を 2 回・候補を 1 回描画。正面、AngleX ±30、AngleY ±20、それぞれ開度 1/0.95/0.9/0.75/0.6/0.59/0.5/0.4/0.3/0.2/0.15/0.11/0.1/0.05/0 を確認。0.11 と 0.59 は遷移の中点。両目の開眼時の残りは消えたが、0.11 と 0.59 には灰色の重なりが残り、0.10→0.15 と 0.55→0.60 では目の形が急変する。半開き期間の肌境界も完全には解消しておらず、滑らかな開閉として採用できない。比較は静止描画であり、動画や物理の検証ではない。Web の最新は v38 のままとし、v44 は比較画像のみ掲載する。

同一セッションの v38 反復は全 5 姿勢・15 開度で差分 0 画素。候補との差分を各タイルの canvas x=250〜560、y=130〜310 の外で集計すると、正面、X−30、X+30、Y−20、Y+20 はいずれも 0 画素。結果は `web/public/kohako/live2d/compare/kohako-v44-{pixel-diff,repeat-diff}.json`。比較画像は同ディレクトリの `kohako-v44-eyes-{0..4}.jpg`、`kohako-v44-blink.jpg`。各比較画像は原画・v38・候補を同じ倍率で配置。連続シートは正面 0→1→0 の 0.05 刻みで、復路は往路画像を逆順に使用。

## 再構築

既存の `WORK`（v17、psd2live、Gradle キャッシュ、bust29、v28 aligned）と `OUT/v29-mask.png`、指定済み素材と参照が必要。固定 digest の Docker イメージを使用し、MCP 18767 は共通ロックで直列化、サーバーは `--log-driver none`。画像や認証情報を外部に送らない。

```sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td44/out bash apps/kohako-studio/rig/kohako-v38/build.sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td44/out \
EYE_REF=/home/boxp/b441work/td43/refs/4-v38-eyes.png \
EYE_ASSET=/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/codex-eyes-half-v43-1.png \
bash apps/kohako-studio/rig/kohako-v44/build.sh
uv run --python 3.12 --with pillow --with numpy python apps/kohako-studio/rig/kohako-v44/compare.py /home/boxp/b441work/td44/out/v44/out /home/boxp/b441work/work/bust29.png apps/kohako-studio/web/public/kohako/live2d/compare
cp /home/boxp/b441work/td44/out/v44/out/v44-blink.jpg apps/kohako-studio/web/public/kohako/live2d/compare/kohako-v44-blink.jpg
```

- 素材 SHA-256 `fe53d258fba10cfe7960690a878f9d664429e4d1b3fbf520eeee650ae682f0f6`
- v38 SHA-256 `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260`（指定値一致）
- 再ビルド v43 SHA-256 `8484c1e8709b270e88f484df5398178115d48eb1a4a62a65aa04a83fe4a4d9c0`
- 候補 p2lrt SHA-256 `e0612539f73ee0f299d095eb9e7d22711d49f34e84a8f9047c83c04721622389`（compiler 3.7.0、配布せず OUT に保持）
- 残件: 遷移中の二重像、目の形と肌境界の連続性、動画・物理と本人による美術確認。次案では中間形状を増やすなど、単一パッチの急な差し替えを避ける検討が必要。
