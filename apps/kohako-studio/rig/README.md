# コハコ v6 リグ再構築

`./rebuild.sh VAULT WORK_DIR` を実行する。履歴スクリプトは `boxp/even-g2-lab` の `origin/main` commit `2ca1027c8acdf98246623b2c46d70afa253449c9` にある `docs/project_docs/BOXP-441/` から移した。コンテナ内のパスは `/tmp/boxp441` に固定し、引数の作業ディレクトリとは `docker cp` で受け渡す。Docker、git、ネットワーク、空き容量が必要。Vault は `attachments/kohako-exe-navigation-ai-character-sheet-final.png` と `Projects/kohako-openamika-ui/live2d/gen/` を含む BOXP のルート。WORK_DIR はスクラッチとして使用し、成功時 `v6/out/kohako-v6.p2lrt` と中間 layout を置く。画像素材はリポジトリに含めない。再実行時は開始時に WORK_DIR 内の出力ディレクトリ(kohako, v1〜v3, v5b, v6, v13, v14, v14b)を削除してから作り直すため、前回の成果物は残らない(psd2live と gradle-cache は再利用する)。

- `kohako-min`: キャラクターシートの左上胸像 (300,60)-(980,710) を切り、目・口などを分ける。
- `kohako-v1`, `v2`, `v3`: 承認済み gen の頭・後ろ髪を参照し、髪と顔を分離する。v5 の入力は v3。
- `kohako-v5`: 近似マスクを使って、承認済み衣装素材を ECC で位置合わせし、三つ編み下を補完する。
- `kohako-v6`: 顔などの素材を補修し、legacy-standard で rig を生成する。`build.py` → `opacity.py` → `iris.py` → `mid.py` → `mouth.py` → `mouth_open.py` → `finalize.py` の MCP 操作で不透明度キー等を設定し、p2lrt へ export する。modern は履歴上 binding branch order エラーとなる。

**再現上の制約:** 元の v5 `outfit-defect.png` / `hole.npy` は保存されていなかった。`outfit-defect-approx.png` は v3 の左右三つ編みの alpha >=250 を半径 9px で膨張し、胸像の (175,335)-(600,575) に切り出した 425×240 の二値マスク（マゼンタ=欠損）。`make_mask.py` は作成方法を示す。位置合わせも変わり得るため、配備物とのバイト一致や見た目の一致を保証できない。

psd2live は commit `6fe868a20c7bf12586fa8ce0a05982f099faa865`（GPL-3.0、compiler 3.7.0）をビルドツールとして利用し、Cubism Core/SDK を取得しない。出力は自分たちの素材から生成したモデルで、ツール自体を配布しない。ライセンスについての最終判断は配布形態も含めて確認すること。

Docker の名前付き volume と `docker cp` によりデーモンが別名前空間でも入力を渡す。MCP は Docker host network のポート 18767 を使用するため、他のサービスとの競合を避ける。キャラクターシートと gen 4 枚の SHA-256 を入力時に照合し、Docker イメージ digest と画像演算の依存バージョンを入口スクリプトで固定する。Gradle キャッシュが WORK_DIR にあれば利用し、初回のキャッシュは終了時に保存する。

`mcp_proxy.py` は psd2live の pin commit に含まれるものをビルド時に使う。MCP クライアントを別途同梱する必要はない。

## v13 の再構築と制約

同じコマンドは v6 と v13 の両方を生成し、`WORK_DIR/v13/out/kohako-v13.p2lrt` と loss report を出力する。`kohako-v13/create_parts.py` は v6 の顔・目・口を変えず、原画の後ろ髪の露出部分を body から後ろ髪へ移し、18px のフェードで境界を緩める。角度と後ろ髪の変形への追従を試すもので、体に残る髪との継ぎ目は未解消。元画像も中間画像もリポジトリには含めない。`capture.py` の Shake は曲線を線形補間した近似で、物理シミュレーションは含まない。静止画の原画は全ポーズで同一であり、回転時の正解画像ではない。

## v14 / v14b の再構築

同じ `rebuild.sh VAULT WORK_DIR` は v13 に続けて、`WORK_DIR/v14/out/kohako-v14.p2lrt` と比較試案 `WORK_DIR/v14b/out/kohako-v14b.p2lrt`、それぞれの loss report と静止ポーズを出力する。v14 は v13 の後ろ髪の生成由来部分を原画の髪の小片を拡張した色と線に置き換える。v14b はその上で、原画の外側の髪の暗い領域の一部を body から動く後ろ髪へ追加移動する。どちらも手作業の近似で、体側に残る髪との継ぎ目を完全には解消しない。画像生成は行わない。

`kohako-v14/capture.py` は静止パラメータの描画で、物理シミュレーションではない。`kohako-v14/make_compare.py WORK_DIR OUTPUT_DIR` は Pillow と NumPy がある環境で比較 PNG と露出領域を出力する。露出マスクは別描画した後ろ髪の alpha × (1 − 前景合成 alpha) が 5% 超の位置で、v13 で移した原画の髪も含む。静止原画との色差は、動かしたポーズの美術上の正解との距離を表さない。

## v15 / v15b の再構築

同じ `rebuild.sh VAULT WORK_DIR` で `v15/out/kohako-v15.p2lrt` と `v15b/out/kohako-v15b.p2lrt`、loss report、静止ポーズ、選択マスクを出力する。v15 は v14 の体側の暗色領域を後ろ髪へ移し、v15b はより広い範囲に原画の画素を使い、肩付近に Telea 補完の体追従下地を加える。画像生成は行わない。両案ともマスクは手作業の近似で、完全分離や実時間の物理品質は保証しない。再実行時には v15、v15b の出力ディレクトリも削除する。

v15c は v15b に加え、既存の三つ編みの裏に残る暗い体側補完を選択して除き、原画の外周で半透明の後ろ髪画素に 1 px の defringe を適用する。v15e は v15 の閉眼層だけを、Vault に既存の `codex-eyes-closed-v14-1.png` を ECC で合わせて肌色を補正した素材に差し替える。生成素材の作成はこのスクリプトでは行わない。`v15e/out/v15e-eyes.png` は物理シミュレーションなしの正面と X±20 の閉眼で、`v13/out/v15e-eyes.png` も比較用に出る。`kohako-v15/make_compare.py WORK_DIR OUTPUT_DIR` および `kohako-v15e/make_compare.py WORK_DIR OUTPUT_DIR` で比較画像を再生成できる。実行には Pillow が必要。v15c と v15e の出力ディレクトリも再実行時に削除される。

## v16 の再構築

同じコマンドで v13 の layout に既存の閉眼素材と `codex-mouth-closed-v16-1.png` を位置合わせし、`v16/out/kohako-v16.p2lrt` と比較用の静止ポーズを出力する。素材の SHA-256 を検証する。閉眼は v15e と同じ ECC と肌色補正を使い、開眼・閉眼の不透明度は 0.30〜0.35 で交差させる。閉口は目・口を除く顔周辺で ECC を行い、肌色を補正した楕円パッチを用いる。再実行時に v16 出力も削除する。`kohako-v16/make_compare.py WORK_DIR OUTPUT_DIR` で静止比較 JPEG を作る。角度付き原画は静止原画の繰り返しであり、動作中の正解画像ではない。画像生成は再構築では行わない。

## v17 の再構築

同じコマンドで v16 に半開き口素材 `codex-mouth-half-v17-1.png` を追加し、`v17/out/kohako-v17.p2lrt` と静止ポーズを出力する。素材の SHA-256 を検証し、目と口を除く顔周辺で affine ECC、肌色補正を行う。上唇の位置は原画に合わせて 2 px 上へ補正し、閉口・半開き・開口の短い不透明度交差を設定する。再実行時に v17 出力も削除される。`kohako-v17/make_compare.py WORK_DIR OUTPUT_DIR` で比較 JPEG を生成する。原画は各行同一の静止画であり、静止ポーズに物理シミュレーションは含まない。画像生成は再構築時に行わない。

## v19 の再構築

半開きメッシュの既存 3×3 キー格子で閉口側の頂点を上に移す3案を試したが、口端の断片が残るため最終版は v17 と同一に戻した。`rebuild.sh` は v17 の描画・モデルを v19 として複製し、開始時に v19 の出力も削除する。`kohako-v19/deform*.py` は不採用の試行操作、`capture.py` と `make_compare.py` は静止比較用。比較は物理を含まない。最終 v19 が同一バイナリのため Web には比較画像だけを掲載する。

v20 は閉口線と生成された半開き線が一致しなかったため統合を見送り、v17 と同一。比較画像の再作成については `kohako-v20/README.md` を参照。

## v23 の再構築

v17 のレイアウトを起点に、肩線で長い髪を頭に追従する上部と体に留まる下部に分割します。再構築時は必ず v17 の layout から開始してください。詳細は [kohako-v23/README.md](kohako-v23/README.md) を参照してください。

## v24 の再構築

v23 のレイアウト（`/tmp/boxp441/v23/layout`）を起点に、(1) 髪飾りの形で髪色に塗られていた体・後ろ髪の下地を推定した頭の輪郭の外側だけ透明にし、(2) 閉口線・半開きの口レイヤーを外して原画の開口 1 枚を psd2live の口テンプレートで閉じ、(3) 目はまぶた変形で 1→`V24_EYE_EPS`（既定 0.15）まで閉じてそれ以下だけ生成閉眼パッチに切り替えます。`V23_Y0`/`V23_Y1`/`V24_EYE_EPS` はホストの環境変数としてコンテナへ渡されます。詳細は [kohako-v24/README.md](kohako-v24/README.md) を参照してください。

## v25 の再構築

v23 の閉口素材を顔詳細として追加し、口 0〜0.08 の不透明度を切り替えます。詳細は [kohako-v25/README.md](kohako-v25/README.md) を参照してください。

| 版 | 再構築結果 |
|---|---|
| v25 | `v25/out/kohako-v25.p2lrt` と loss report、静止比較用の描画 |
