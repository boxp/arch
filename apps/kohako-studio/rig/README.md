# コハコ v6 リグ再構築

`./rebuild.sh VAULT WORK_DIR` を実行する。履歴スクリプトは `boxp/even-g2-lab` の `origin/main` commit `2ca1027c8acdf98246623b2c46d70afa253449c9` にある `docs/project_docs/BOXP-441/` から移した。コンテナ内のパスは `/tmp/boxp441` に固定し、引数の作業ディレクトリとは `docker cp` で受け渡す。Docker、git、ネットワーク、空き容量が必要。Vault は `attachments/kohako-exe-navigation-ai-character-sheet-final.png` と `Projects/kohako-openamika-ui/live2d/gen/` を含む BOXP のルート。WORK_DIR はスクラッチとして使用し、成功時 `v6/out/kohako-v6.p2lrt` と中間 layout を置く。画像素材はリポジトリに含めない。既存の同名出力を使うディレクトリは指定しない。

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
