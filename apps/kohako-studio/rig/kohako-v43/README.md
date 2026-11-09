# kohako-v43（不採用）

BOXP-441 / TD-30。Codex 組込み image_gen を半開き目に 1 回使用し、生成素材を v38 に統合した試作。公式 Cubism Core は使っていない。口素材は生成していない。

## 手順

v38 を `WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td43/out bash apps/kohako-studio/rig/kohako-v38/build.sh` で再構築し、SHA-256 が `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260` と一致した。`OUT/v29-mask.png` と既存の v17・psd2live・Gradle キャッシュが必要。v43 は以下のように実行する。

```sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td43/out \
EYE_REF=/home/boxp/b441work/td43/refs/4-v38-eyes.png \
EYE_ASSET=/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/codex-eyes-half-v43-1.png \
bash apps/kohako-studio/rig/kohako-v43/build.sh
uv run --python 3.12 --with pillow --with numpy python apps/kohako-studio/rig/kohako-v43/compare.py /home/boxp/b441work/td43/out/v43/out /home/boxp/b441work/work/bust29.png apps/kohako-studio/web/public/kohako/live2d/compare
```

固定 digest の Docker イメージ、共通ロックで直列化した MCP 18767、`--log-driver none` を使用する。モデル画像や token は外部に送らない。生成素材 SHA-256 は `fe53d258fba10cfe7960690a878f9d664429e4d1b3fbf520eeee650ae682f0f6`。参照・生成履歴は vault の `live2d/gen/provenance.md` に記録。

`parts.py` は生成画像を参照目元に ECC アフィン整合し、参照目元を canvas (300,160) に x 0.429104、y 0.430108 倍で配置する。ECC 相関 0.992058、行列は `[[1.0041025, 0.0071290, -2.49908], [-0.00035465, 0.9977423, 1.59305]]`。左右を楕円フェード付きパッチにし、`eyes.py` で中間 0.4〜0.5 に表示、0.15 と 0.75 で消す。既存の開眼層は逆方向に交差させ、0〜0.15 の閉眼パッチは v38 の設定を維持。口・髪・右肩の実装は変更していない。

## 評価

同じ MCP クライアント・サーバープロセスで v38 を2回、候補を1回描画。正面、AngleX ±30、AngleY ±20 の 5 姿勢それぞれ 1 / 0.75 / 0.6 / 0.5 / 0.4 / 0.3 / 0.2 / 0.15 / 0.1 / 0 の画像を比較した。v38 の反復描画は全姿勢で差分 0 画素。候補と v38 の canvas x=250〜560、y=130〜310 の外の差分は全姿勢で 0 画素。画素差の集計 JSON と比較画像は `web/public/kohako/live2d/compare/kohako-v43-*`。静止画像であり、物理を含む動画の検証ではない。

候補は 1 でも片目が半開きになり、0.6 と 0.3 の切替ではまつ毛や虹彩が薄く重なって不自然。0.4〜0.5 の素材自体は半開きに見えるが、連続した開閉の条件を満たさないため不採用。v38 を最新として維持する。0→1→0 シートは 0.05 刻みの静止フレームで、復路は往路の画像を逆順に再利用する。

試作 p2lrt SHA-256 `8484c1e8709b270e88f484df5398178115d48eb1a4a62a65aa04a83fe4a4d9c0`（compiler 3.7.0、losses `[]`）。残り: 片目の開眼時の表示残りと、遷移での二重線・肌境界の原因を特定し、両目を正しく独立制御したうえで動画・物理を含め再検証する。
