# コハコの家の実ブラウザ検証（BOXP-500）

Playwright コンテナ（`mcr.microsoft.com/playwright:v1.56.1-noble`、`npm i playwright@1.56.1`）で `node verify.mjs out/<name>` を実行します。
`TOKEN_FILE` に検証用 ServiceAccount token（audience `kohako-bff-verifier`）のパスを渡します。token は出力しません。

- `MODE=local`（既定）: `/work/site/kohako/` に置いたローカル build を表示し、API だけ配備中 BFF へ中継します。
- `MODE=deployed`: 画面も配備版（クラスタ内 Service）から取得します。
- `ONLY=pc,stop,reload,dup,net,approvalmock,mobile,studio` で項目を絞れます。`approval` は実承認の発生を待つ項目です（検証用の会話ではツールが制限されるため通常は発生しません）。`approvalmock` は GET の応答だけを承認状態に差し替え、拒否は実 BFF へ送ってエラー表示を確かめます。

検証用の会話（`kohako-verify-…`）は Owner の Web 会話とは別です。承認は拒否しか送れません。

`poll502.mjs` は BFF を完全にモックし、依頼のポーリング中に一時的な 502 が返っても、また再読込後の初回照会が通信例外になっても、初回照会の応答待ちの間に新規送信しようとしても、POST の応答前に再読込しても（送信前に受付番号を控える）追跡を続けて結果を受け取ること（再送しない）と、404 では終了すること、再読込後の初回照会が 401 なら（POST 応答前の再読込を含め）未認証表示で送信を止め控えを残すことを確かめます。ローカル build を `/site/kohako/` に置いて `node poll502.mjs` で実行します（token 不要）。
