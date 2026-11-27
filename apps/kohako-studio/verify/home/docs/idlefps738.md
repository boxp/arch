# idlefps738.mjs（BOXP-738）

通常版の家と、待機中のコハコの描画を間引く候補 `idlefps-22f3133` を、同じ Chrome・同じ画面の大きさ・同じモックの API で比べる計測の道具です（BOXP-730 の計測の方式を流用）。

- 準備: 通常版（main）と候補のタグの `web/` をそれぞれ `npm ci && npm run build`。`NDIST`・`CDIST` に各 `dist` を渡すと :18731 / :18732 の `/kohako/` で配ります。
- Chrome: Playwright コンテナ（`mcr.microsoft.com/playwright:v1.56.1-noble`、`--network host --cpus 4`）で Xvfb を起こし、Chrome 141 をヘッド付き・`--use-angle=swiftshader --enable-unsafe-swiftshader --remote-debugging-port=39731` で起動しておきます（コンテナ名 `pw738`。プロセスごとの CPU を `docker exec` で読む）。
- 実行: `NDIST=… CDIST=… node idlefps738.mjs <出力先>`（`PHASE_S` で 1 項目の秒数、`ONLY` で項目を絞る）。
- 出力: `result.json`（項目ごとの Chrome のプロセス別 CPU%・メモリ、rAF 回数/秒、コハコの描き直し回数/秒、WebGL の描画呼び出し/秒、候補の `report.frameCap`）と各項目のスクリーンショット。時間の流れの項目は 1 秒ごとの描き直し回数と、待機 → マウス → 発言 → 返事 → 裏タブ → 前面の印。
- 限界: GPU の無い環境では GPU の仕事を SwiftShader が CPU で代行するので、CPU% は実機の値ではありません。描き直しの回数と、回数を減らした時の下がり方の比を見ます。
