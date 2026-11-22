# context663.mjs（BOXP-663）

`context663.mjs`（BOXP-663）は BFF を完全にモックし、動く姿の WebGL コンテキストが失われた時（スマホで開き直した時・GPU のメモリ逼迫）に、コハコが消えたまま・失われた canvas が残ったままにならないことを実ブラウザで確かめます。喪失と復帰は `WEBGL_lose_context` で起こします（実機の喪失と同じ `webglcontextlost` / `webglcontextrestored` が届きます）。

- `mobile`（844×390・DPR 3・横向き）/ `pc`（1200×800）: 喪失中は静止画が見え canvas は隠れること、復帰後に動く姿へ戻り canvas に絵が描かれていること。
- `norestore`: 復帰しない場合も静止画で姿が見え続けること。
- `hidden`: 画面を離れている間に失われ、戻ってから復帰する流れでも同じこと。

`node context663.mjs <build の dist> <出力先>`（Playwright 1.56.1、token 不要、`ONLY=mobile,pc,norestore,hidden` で絞れます。`PW_WS=ws://host:port/` で起動済みの Playwright サーバーへ接続できます。`BASE=` で配備版の画面を開けます（API は同じくモック）。`EXPECT=0` は判定せず測定だけ行います）。各項目の喪失前・喪失中・復帰後の画面と `result.json` を出力先に保存し、失敗があれば終了コード 1 です。

headless の swiftshader での測定です。iOS 実機で失われた canvas が白く見えるか、実機の開き直しで実際に喪失・復帰が起きるかはこの環境では確かめられません。
