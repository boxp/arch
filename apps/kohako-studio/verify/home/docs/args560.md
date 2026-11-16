# args560.mjs（BOXP-560）

`args560.mjs`（BOXP-560）は、手順の行の中に道具名と実行内容（実引数）を一緒に表示することを PC と Pixel 7 縦で検証します。一覧と詳細の応答は BFF の実コード（`activity.ts` / `secrets.ts`）で作るので、伏字と上限は実物を通ります。terminal / read_file / web_search / skill_view / execute_code / patch の表示、引数用の別ボタン・別欄が無いこと、手順一覧を畳んだままなら取り寄せないこと、実引数が届く前の開始通知の内容表示と届いた後の自動置き換え、スクロール位置の保持、仕込んだ秘密値と思考が DOM に無いこと、横はみ出し・入力欄との重なり・外部通信・ページエラーを確かめます。

BFF を `npx tsc -p tsconfig.json --outDir <dir>`（`bff` で実行）でビルドし、Web のビルドを `SITE`（既定 `/site`）の `kohako/` に置いて、`BFF_DIST=<dir> node args560.mjs /out` を実行します（`PORT` 既定 8810、Playwright で動作確認済み）。画像と `result.json` を保存し、失敗時は終了コード 1 です。
