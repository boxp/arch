# コハコの家の実ブラウザ検証（BOXP-500）

Playwright コンテナ（`mcr.microsoft.com/playwright:v1.56.1-noble`、`npm i playwright@1.56.1`）で `node verify.mjs out/<name>` を実行します。
`TOKEN_FILE` に検証用 ServiceAccount token（audience `kohako-bff-verifier`）のパスを渡します。token は出力しません。

- `MODE=local`（既定）: `/work/site/kohako/` に置いたローカル build を表示し、API だけ配備中 BFF へ中継します。
- `MODE=deployed`: 画面も配備版（クラスタ内 Service）から取得します。
- `ONLY=pc,stop,reload,dup,net,approvalmock,mobile,studio` で項目を絞れます。`approval` は実承認の発生を待つ項目です（検証用の会話ではツールが制限されるため通常は発生しません）。`approvalmock` は GET の応答だけを承認状態に差し替え、拒否は実 BFF へ送ってエラー表示を確かめます。

検証用の会話（`kohako-verify-…`）は Owner の Web 会話とは別です。承認は拒否しか送れません。

`touchgate.mjs` は BFF を完全にモックし、平常時はなでると接触 event を 1 回送り、読み上げ中やなでた直後に録音を始めた場合は送らないことを確かめます（`node touchgate.mjs`、token 不要）。

`poll502.mjs` は BFF を完全にモックし、依頼のポーリング中に一時的な 502 が返っても、また再読込後の初回照会が通信例外になっても、初回照会の応答待ちの間に新規送信しようとしても、POST の応答前に再読込しても（送信前に受付番号を控える）追跡を続けて結果を受け取ること（再送しない）と、404 では終了すること、再読込後の初回照会が 401 なら（POST 応答前の再読込を含め）未認証表示で送信を止め控えを残すことを確かめます。ローカル build を `/site/kohako/` に置いて `node poll502.mjs` で実行します（token 不要）。

`mouthpet.mjs` はローカル build と完全な BFF モックで、無音再生中の推定口形と PC / Pixel 7 の頭追従を記録します。Playwright 1.56.1 の node_modules を /pw、build を /site/kohako、出力先を /out に置いて実行します。動きを減らす設定では口の幅変形と頭追従を無効にし、口の開閉のみ残します。口形は文字ベースの近似で、漢字の読みや実際の音素は認識しません。

`pat.mjs` は同じ条件で頭を右・左になでたときの petFollow 値と顔周辺の画像（静止 / 右 / 左 / 離した後）を /out に保存します（Playwright のパッケージ解決のため /pw/node_modules/playwright-core へのリンクが必要です）。

`petvisible.mjs`（BOXP-505 TD-01）は、頭をなでたときに**最終描画で**頭が傾いて見え、離すと戻ることを画素から確かめる回帰検査です。petFollow や setParameter の値ではなく、スクリーンショットの左右の瞳（青）の重心を結ぶ線の傾き（度）と首肩のずれ（px）を測ります。待機クリップも頭を揺らすため、最初に触らずに 8 回測った待機の平均・揺れ幅と比べます。PC（実マウス）と Pixel 7（touch）で右側・左側・中央をまたぐ往復・縦（PC のみ。touch の縦は `touch-action: pan-y` でスクロールになる）のなでを行い、右なでと左なでの差が 10° 以上、各なでが待機から 3° 以上、ふれあい OFF と動きを減らす設定では 3° 以内、ホバーでは追従しないこと、離して 3 秒後に待機の揺れの内側へ戻ることを確かめ、失敗があれば終了コード 1 にします。`node petvisible.mjs <build の dist> <出力先>`（Playwright 1.56.1、BFF は完全にモック、token 不要）。`ONLY=pc,pixel7,reduced,touchoff` で絞れます。連続フレーム（なで中・離して 0.4 秒・3 秒）の画像を出力先に保存します。

`statusview.mjs` は `STATUS_JSON` の実データ写しと BFF モックを使い、舞台内ウィジェットの数値、詳細の開閉、各画面サイズの重なり、取得失敗時の表示を確認し、スクリーンショットを保存します。

`viewpanel.mjs` は BFF をモックして地図・利用枠・HTML 図の表示、iframe の制約、操作欄との重なりを PC・スマートフォンで検証します。ビルドを `SITE`（既定 `/site`）の `kohako/` に配置し、必要に応じて `PORT` と出力ディレクトリ引数を指定して実行します。

`queue.mjs`（BOXP-508）は token 不要の完全な BFF モックを使い、PC と Pixel 7 相当の送信待ち、FIFO、読み上げ中の追加発言（読み上げを中断しない）、通信切れ時の保留（再接続だけでは送らない）、保留・再開、承認、受理未確認、上限と画面配置を検証します。ビルドを `/site/kohako`、出力先を `/out` に置き、Playwright 1.56.1 で `node queue.mjs /out` を実行します。結果は `result.json` とスクリーンショットに保存され、失敗時は終了コード 1 です。

`usability510.mjs`（BOXP-510）は token 不要の完全な BFF モックで、PC と Pixel 7 相当の Enter 改行・Shift+Enter 送信、Markdown の安全な描画（script・javascript: リンク・画像を無効化し外部通信 0 件）、本文表示中の利用枠ウィジェット非表示、履歴・受信箱の昇順、背景の動きと OS の reduced-motion・「背景を動かす」OFF での静止を確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node usability510.mjs /out` を実行します。

`background512.mjs`（BOXP-512）は BFF を完全にモックし、PC・Pixel 7 相当縦・スマホ横で時間帯と旧背景の表示、動きと各停止条件、連続画像の輝度差、文字のコントラスト、入力・ポインター操作を検証します。PC と Pixel 7 では CDP の処理時間とフレーム間隔も測定します。Playwright 1.56.1 でビルドを `SITE`（既定 `/site`）の `kohako/` に置き、`node background512.mjs /out` を実行します（`PORT` 既定 8795）。結果とスクリーンショットを出力し、assert 失敗または外部通信があれば終了コード 1 です。

`menus512.mjs`（BOXP-512 TD-01）は BFF を完全にモックし、PC・Pixel 7 相当縦・スマホ横でヘッダーと、そこから開くメニュー（読み上げ・ふれあい・受信箱・履歴・設定・Studio リンク）の開閉、Esc、焦点の戻り、スイッチの保存とキーボード操作、受信箱の既読・選択返信・処理済み、履歴の並びと Markdown、面が画面内に収まることを確かめ、各状態の画像を保存します。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node menus512.mjs /out` を実行します（`PORT` 既定 8796、`EMPTY=1` で通知 0 件の状態）。assert 失敗または外部通信があれば終了コード 1 です。
