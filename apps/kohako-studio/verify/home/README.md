# コハコの家の実ブラウザ検証（BOXP-500）

Playwright コンテナ（`mcr.microsoft.com/playwright:v1.56.1-noble`、`npm i playwright@1.56.1`）で `node verify.mjs out/<name>` を実行します。
`TOKEN_FILE` に検証用 ServiceAccount token（audience `kohako-bff-verifier`）のパスを渡します。token は出力しません。

- `MODE=local`（既定）: `/work/site/kohako/` に置いたローカル build を表示し、API だけ配備中 BFF へ中継します。
- `MODE=deployed`: 画面も配備版（クラスタ内 Service）から取得します。
- `ONLY=pc,stop,reload,dup,net,approvalmock,mobile,studio` で項目を絞れます。`approval` は実承認の発生を待つ項目です（検証用の会話ではツールが制限されるため通常は発生しません）。`approvalmock` は GET の応答だけを承認状態に差し替え、拒否は実 BFF へ送ってエラー表示を確かめます。

検証用の会話（`kohako-verify-…`）は Owner の Web 会話とは別です。承認は拒否しか送れません。

## スクリプトの説明

各スクリプトの説明は `docs/<script名>.md` にあります。追加時は専用の `docs/<script名>.md` を作り、この README には追記しないでください。共有ファイルへの同時編集による衝突を避けます（BOXP-552）。一覧は `ls docs/` で確認できます。

`reauth523.mjs`（BOXP-523）は BFF をモックし、PC 1280×800 と Pixel 7 相当 412×915 で認証切れから手動再読み込みした後の草稿・保留キューの復元、通常の通信切断での再接続、再認証失敗時の自動再読み込み防止、受理未確認の GET 照会と重複 POST 防止、控えと同じ本文の送信待ちと草稿が控えの照会失敗時も失われないこと（e）、控えと同じ本文を手で入力した草稿が控えの再確認に吸収されず送信待ちとして残ること（f）、送信待ちが満杯でその草稿を退避できないときは再読み込み前に明示の確認を出し取り消せば再読み込みしないこと（g）、控えの照会が 401 で入力欄に戻った控えの写しが再認証後に受理済みと判明したら入力欄から外れ重複送信できないこと（h）、再認証後の初期化を待つ間に別の文を入力しても退避した草稿が上書き・破棄されず送信待ちに保留で残ること（i）、待つ間に退避した草稿と同じ本文を入力しても 2 件とも残ること（j）を確認します。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node reauth523.mjs /out` を実行します。結果は `result.json` に保存し、失敗時は終了コード 1 です。
