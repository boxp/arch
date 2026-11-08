# BOXP-441 TD-40: full-v11a 頭部キット

**担当自己評価: 未受入、比較用。** Owner の判定ではない。原画・v10k より目の形と大きさ、顔の色味が異なる。目の切替で灰色の重なりと急な変化があり、口の開きは小さい。拡大すると目の輪郭が点状に荒れ、口の細線には緑がかった画素が残る。採否にかかわらず Studio に掲載し、既定は kohako-v45 のままとした。

## 確定したこと

- v10k を指定の layout、psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865` と `kohako-full-v10k/anchor.patch` から再構築し、SHA-256 `2e9377ddd7ed5ff427886ab31caa170e39af5244db13a1e4483bfe519214cb5e` が掲載版と一致した。
- v11a の p2lrt SHA-256 は `f4c376e3cdaa8dfe71d3c6273738b9676ee7eb7434214796a85d487746233016`。入力素材は提供済みの `kit-face-1.png`、`kit-eyes-1.png`、`kit-mouth-1.png`。画像生成、外部画像 API、Core 取得は行っていない。
- 緑からの距離で alpha を作り、緑を抑制。顔の首部分は顎の線で切り、既存 face の alpha と矩形に収めた。既存 neck、前髪、三つ編み、胴体、腕、脚の画像は変更していない。眉は元の face にあり、元画像から線を抽出し前髪の手前ではなくその下の face detail に残した。肌パッチや inpaint は追加していない。
- 顔は元 crop と layout の縮尺に基づき約 0.3205 倍、目は約 0.1535 倍、口は約 0.074 倍で配置。目は同一行座標の共通変換、口はシート上の線の行間約315pxを取り除いた共通変換を用い、状態ごとの位置合わせはしていない。白目、虹彩、線を色で分けた。虹彩のクリップ用に白目の不透明領域を虹彩の背後まで設けた。
- 顔・眉・目・口は画像を layout 矩形の2倍画素で渡し、import と export は成功した。最終描画での実効解像度がすべて2倍維持されることまでは検証していない。目の不透明度キーは v10k と同じ。口は 0〜0.10 閉、0.12〜0.50 中、0.55〜1 開とし、その間に短い遷移を置いた。
- workspace の layer ID に対応するメッシュは、眉 `ArtMeshFaceDetail`、口中 `ArtMeshFaceDetail2`、口閉 `ArtMeshFaceDetail3`、左半目 `ArtMeshFaceDetail4`、右半目 `ArtMeshFaceDetail5`、口開 `ArtMeshMouthOpen` と別々である。キー衝突を避けるため build.py でも一意性を検査する。
- MCP と export は v10k と同じ環境変数を使用。入力と削除対象出力の重なり検査と一意なコンテナ・volume 名を維持し、MCP コンテナは `--log-driver none`。既存 v10k と同じく Idle/Talk の builtin seed は失敗したが、motion modifier の生成は成功した。

## Chromium での評価

Chromium / SwiftShader、静止・状態シートは DPR 2、上半身フレーム、behaviors 停止。`static.jpg` は左から原画 v0、v10k、v11a の顔拡大と上半身。原画はラスタ画像、他は実ランタイム描画で、画角と背景は完全に同一ではない。v11a は瞳が小さめで横長、顔の陰影が淡く、目の線が原画より細く断片的。顔の同一性は未達と判断する。

`eye.jpg` / `mouth.jpg` は上半身で各21状態を0.05刻み、`*-detail.jpg` はその顔拡大。目 0.60 は開眼と半目が重なって灰色に見え、0.15→0.10 は急に閉眼へ切り替わる。口は 0.05刻みでは明瞭な二重の上唇線は見えないが、開口時の面積が小さく、3状態の差が弱い。遷移幅 0.02/0.05 の中間全点はこのシートで検証できず、二重線が絶対にないとは断定しない。口線には拡大時に緑がかった画素が見え、despill は不十分。

`poses.jpg` は rest、idle4、idle10、AngleX ±20、AngleZ ±10、BodyAngleX ±10 の v10k / v11a 対比。大きな頭部の破断は目視で見えなかったが、完全な境界一致は確認できない。頭部付近の device-pixel ROI x=280..559, y=60..399 で、v11a がほぼ純マゼンタかつ v10k がそうでない画素数は順に 0、21、22、11、6、68、133、20、13。これは外輪郭のサブピクセル差も含み、各画素が新しい穴かどうかは識別しない。特に回転時の顔・前髪・首境界と既存の髪の隙間は追加確認が必要。

## 動画と比較資料

`web/public/kohako/live2d/compare/kohako-full-v11a-*`:

- `normal-pair.mp4`: 左 v10k、右 v11a。20秒・8fps、behaviors 停止で同一の決定論的パラメータ軌道。0〜5秒待機風、5〜10秒考え中風、10〜15秒 AngleZ、15〜20秒 BodyAngleX。目は開、口は閉の軌道である。
- `contact.jpg`: 上記の0、5、10、15秒の時刻付き静止比較。
- `natural.mp4`: v11a の待機→考え中→発話、15秒。実時間で撮った64枚を均等配置した約4.3fpsの記録であり、短時間の破綻を見逃しうる。
- `static.jpg`、`eye.jpg`、`eye-detail.jpg`、`mouth.jpg`、`mouth-detail.jpg`、`poses.jpg`: 上述の静止比較。画像はいずれも1.5MB以下、動画はいずれも8MB以下。

## 再現と残件

新しい作業ディレクトリに `/home/boxp/b441work/full10h/build/layout` をコピーし、`prepare.py` を Pillow、NumPy、OpenCV のある環境で `LAYOUT` にそのコピー、`KIT` に `/home/boxp/b441work/td-kit/gen` を指定して一度実行する。提供の `tdkit` では `/w/layout` と `/w/kit` が既定。準備済み layout を `INPUT_LAYOUT` に指定し、SHA-256 `4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84` の原画を `SOURCE`、パッチ済み psd2live を `P2L`、独立した出力先を `OUT`、Gradle キャッシュを `GRADLE_CACHE` に指定して `build.sh` を実行する。元 layout に直接 `prepare.py` を実行しない。比較キャプチャは v10k の `capture-k.cjs` と本ディレクトリの `states.cjs` / `videos.cjs`、シートとエンコードは `sheets.py` / `encode.sh` を使用した。

残件: 目の切替と描画の荒れ、口の小ささと緑残り、原画との同一性、回転時の露出の分類、実 GPU と Owner の確認。最終的な採用判断は未確定。生のキャプチャ JSON はリポジトリに含めない。push、PR、merge、配備はしていない。

最終 Web 検証は `typecheck`、`test`（4 files / 30 tests）、`build` 成功。配信ディレクトリを使った Chromium の確認では v11a のロード成功と比較リンク9件を確認した。
