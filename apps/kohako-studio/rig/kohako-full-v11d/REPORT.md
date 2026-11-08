# BOXP-441 TD-40 full-v11d

未受入の比較候補。最終判定は Opus が行う。LATEST は kohako-v45 のまま。画像生成、Gemini、外部画像 API、Core 取得は行っていない。素材は既存の kit-face-1.png、kit-eyes-1.png、kit-mouth-1.png のみ。

## 仮説と検証

`face.jpg` は実 Chromium / SwiftShader で目の値を 0 にし、face メッシュだけを描画した比較である。v11c の face 単独に左右の旧目元線が存在し、v11d では線の肌上の部分が薄くなる。従って元 face に線が残る仮説は支持される。ただし目尻の暗い影の全成分がこの線に由来することまでは確定できない。合成後の `eye-detail.jpg` と `eye.jpg` では閉眼時の目尻に暗い部分が残り、影が完全に解消したとは判断できない。

## 変更と再現

`/home/boxp/b441work/full10h/build/layout` を別ディレクトリにコピーし、Pillow・NumPy・OpenCV のある環境で `LAYOUT` にそのコピー、`KIT=/home/boxp/b441work/td-kit/gen` を指定して `prepare.py` を一度実行する。v11c と同じ顔合成の後、2倍密度の face にある左右の細い多角形内だけを周囲の肌色から Telea inpaint する。目元の線とそのぼかしを補修対象とし、前髪に近い端を除外した。眉、目、口、髪、体の個別画像は変更していない。入力画像全 PNG の比較では face.png のみが異なる。補修領域外の RGBA は v11c と完全一致し、alpha の変更はゼロ。暗い RGB の最大値が 100 未満の画素は変更されていない。これは髪の全画素の保護を数値的に証明するものではなく、前髪の境界は画像でも確認した。

`build.sh` には準備済み `INPUT_LAYOUT`、SHA-256 `4a2aa4a9484733c6372186e4b7267bd1f631bd3d486971f34aed47768a0d0b84` の `SOURCE`、v10k anchor.patch 適用済み psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865` の `P2L`、独立した `OUT`、`GRADLE_CACHE` を渡す。v11c の入力と出力の重なり検査、一意名、MCP と export の共通環境、MCP の `--log-driver none` を維持。目の opacity 切替は変更していない。

## 比較と自己評価

実 Chromium / SwiftShader、DPR 2、上半身、behaviors 停止。`static.jpg` は原画 v0 / v10k / v11c / v11d の顔と上半身で、原画はラスタ画像のため描画条件は他列と完全には同じでない。`eye.jpg` と `mouth.jpg` は 0.05 刻み、`eye-detail.jpg` は v11c と v11d の 0.60 / 0.15 / 0.10 / 0.00 を拡大する。口レイヤーは同一で、状態シートに目立つ新しい二重口線は見えない。補修部の矩形や大きな色の段差は状態シートでは目立たないが、微細な継ぎ目は未確定。目 0.60 の灰色の重なり、0.15→0.10 の急変と目尻の暗い部分は残る。

`cheeks.jpg` は AngleX ±20、AngleZ ±10 の目元と頬の比較、`poses.jpg` は v11c/v11d の9姿勢マゼンタ比較。既存の髪脇のマゼンタ露出は残る。頭部 ROI（device pixel x=280..559、y=60..399）で v11d がほぼ純マゼンタ、v11c がそうでない画素数は rest、idle4、idle10、X−、X＋、Z−、Z＋、BodyX−、BodyX＋の順にすべて 0。姿勢間の描画差やサブピクセル差はあり得るため、全姿勢・全角度での露出不存在は保証しない。

確定: p2lrt SHA-256 `041534e26784552d66b7563d1e372945c4d673eb5a79b8b770e6bedc1065402c`。MCP import/export は成功。Idle / Talk の builtin seed は v11c 同様に失敗したが motion modifier は生成された。比較画像は各 1.5 MB 以下、生 JSON は含めない。実 GPU、実時間 Blink、動画、切替区間の全点は未検証。push、PR、merge、配備は行っていない。

最終 Web 検証: `npm run typecheck`、`npm test`（4 files / 30 tests）、`npm run build` が成功。配信ディレクトリを使う Chromium で v11d の読込成功と比較リンク 7 件を確認。全体セキュリティ検査 `trivy config .` は trivy が利用できず未実行。

## 担当(Opus)の最終判定

不採用(比較用に掲載のみ)。`face.jpg` と `eye-detail.jpg` を目視した。

- 目尻の外側の暗い影は v11c と変わらない。`face.jpg` の face メッシュ単独描画で、影は左右の目尻の外、横髪の際にある暗いグラデーションとして見える。今回の補修多角形は上まぶたの旧線だけが対象で、影の範囲に届いていない。影が face 層にあることは確認できたが、なぜそこにあるか(元 face の髪の影か、別の由来か)は未確定。
- 上まぶたの旧線は薄くなった一方、閉眼(0.10 以下)で線の跡がピンクの帯として残り、v11c より目立つ箇所がある。
- 目 0.60 の灰色の重なりと 0.15→0.10 の急変は未着手のまま残る。

次は、影の範囲を face 層の画素で特定して肌へ戻す。上まぶたの補修は肌色の合わせ方を見直すか v11c の状態へ戻す。
