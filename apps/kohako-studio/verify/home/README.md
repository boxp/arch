# コハコの家の実ブラウザ検証（BOXP-500）

Playwright コンテナ（`mcr.microsoft.com/playwright:v1.56.1-noble`、`npm i playwright@1.56.1`）で `node verify.mjs out/<name>` を実行します。
`TOKEN_FILE` に検証用 ServiceAccount token（audience `kohako-bff-verifier`）のパスを渡します。token は出力しません。

- `MODE=local`（既定）: `/work/site/kohako/` に置いたローカル build を表示し、API だけ配備中 BFF へ中継します。
- `MODE=deployed`: 画面も配備版（クラスタ内 Service）から取得します。
- `ONLY=pc,stop,reload,dup,net,approvalmock,mobile,studio` で項目を絞れます。`approval` は実承認の発生を待つ項目です（検証用の会話ではツールが制限されるため通常は発生しません）。`approvalmock` は GET の応答だけを承認状態に差し替え、拒否は実 BFF へ送ってエラー表示を確かめます。

検証用の会話（`kohako-verify-…`）は Owner の Web 会話とは別です。承認は拒否しか送れません。

## スクリプトの説明

各スクリプトの説明は `docs/<script名>.md` にあります。追加時は専用の `docs/<script名>.md` を作り、この README には追記しないでください。共有ファイルへの同時編集による衝突を避けます（BOXP-552）。一覧は `ls docs/` で確認できます。
