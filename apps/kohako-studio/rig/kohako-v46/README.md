# kohako-v46（BOXP-441、比較用）

生成済み Gemini 素材を v45 試作3と同じ切替方式に使用した比較用モデル。今回の画像生成は 0 回、公式 Cubism Core と外部画像 API は使用していない。最新は v45 のまま。口・v37 の髪・v38 の右肩は変更しない。

## 位置合わせ

`align.py` は JPEG を PNG に変換し、536×279 の参照4に SIFT 対応点と RANSAC 相似変換で初期位置を求め、目の形が違うため目を除いた前髪・肌のマスクで ECC アフィン補正する。140 対応点中 51 インライア、RANSAC インライアの平均再投影残差 1.67 px、ECC 0.99517。相似変換の縮尺は 0.38917。左右別の変形や色補正は行っていない。前髪は共通の静止部分として合わせ、眼球ではマスクから除外した。v45 と同じ `parts.py` が更に ECC 微調整し、左右を別パッチとして取り込む。

参照4座標の目視概算（形状が異なり点の対応は曖昧、誤差数 px）: 画面左の虹彩中心 約 8 px、目尻 約 2 px、目頭 約 7 px。画面右の虹彩中心 約 3 px、目頭 約 8 px、目尻 約 2 px。これらは共通特徴点の統計誤差ではなく、開度の違いも含む見かけの差。位置合わせ重ね画像 `kohako-v46-alignment-overlay.jpg` と素材比較 `kohako-v46-material.jpg` を掲載。

## 再構築

v45 README と同じ WORK・OUT・参照4、および v29-mask.png が必要。`gemini-aligned.png` は位置合わせ済み素材。

```sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td46/out \
EYE_REF=/home/boxp/b441work/td43/refs/4-v38-eyes.png \
EYE_ASSET="$PWD/apps/kohako-studio/rig/kohako-v46/gemini-aligned.png" \
bash apps/kohako-studio/rig/kohako-v46/build.sh
uv run --python 3.12 --with pillow --with numpy python apps/kohako-studio/rig/kohako-v46/compare_versions.py /home/boxp/b441work/td46/out/v46/out apps/kohako-studio/web/public/kohako/live2d/compare
uv run --python 3.12 --with pillow --with numpy python apps/kohako-studio/rig/kohako-v46/pixel_diff.py /home/boxp/b441work/td46/out/v46/out /home/boxp/b441work/td46/pixel-diff.json
OUT=/home/boxp/b441work/td46/out DEST=apps/kohako-studio/web/public/kohako/live2d/compare bash apps/kohako-studio/rig/kohako-v46/video.sh
```

共通 MCP ポートはロックで直列化し、サーバーログは無効。v38・v45・v46 を同一サーバーで描画し、目元矩形外を比較する。v45 の素材のパスは `EYE_CODEX` で変更できる。`V45_WIDTH=0.004`、`V45_LOW=0.135`、`V45_HIGH=0.60`。

## 結果

正面・X ±30・Y ±20、開度 0〜1 の 0.05 刻みと切替点を同じ MCP セッションで描画した結果、v38 の繰り返し、v38 対 v45、v38 対 v46 はいずれも canvas x=250〜560、y=130〜310 の外で差分 0 画素。静止連続シートは v46 の開度 0.10→0.15 で閉眼から大きく開いた両目に急に切り替わる。v45 の素材はより細い半開き目で、閉眼への段差は小さい。両案とも 0.60 では灰色の重なりが見える。Gemini はまつ毛が濃く太く、虹彩や線の形も原画と異なり、両目とも v45 より大きく開いている。待機 15 秒のトレースでは両案とも閉眼域が 8 回。等速・1/5 スロー・待機の連続シートで両目を確認し、明瞭な灰色二重像や片目残りは見えなかった。v46 は閉眼から大きく開いた目に切り替わり、v45 より段差が大きい。目の周りに大きな肌境界は確認できなかったが、縮小録画では微細な差を断定できない。フレーム時刻と描画パラメータには最大数フレームのずれがある。

- Gemini JPEG SHA-256 `6033984bef2c973707e6cbbef29992a9ff3f5711308b1c8c03d4229330c47269`
- 位置合わせ PNG SHA-256 `d5f251939741a7992887fe02364ff3d26a2a784c2d8b92b90a9b9dfd7a35c5bb`
- v38 `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260`
- v45 `27543e04b1ec69fe3bf5c72b01b8b4ae1af8468844ace78d8dc81214df4f89cd`
- v46 `bf976f05c016534031c45a9b40a2eca2bc42be4875f46e7f0ab704df6579ff39`

採用は担当の判断。静止での灰色重なり、開閉の段差、肌の境界、原画との同一性と本人の美術確認が残る。
