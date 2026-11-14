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

`statusview.mjs` は `STATUS_JSON` の実データ写しと BFF モックを使い、PC・横画面のウィジェットの数値、詳細の開閉、重なり、取得失敗時の表示と、縦画面での非表示を確認し、スクリーンショットを保存します。

`viewpanel.mjs` は BFF をモックして地図・利用枠・HTML 図の表示、iframe の制約、操作欄との重なりを PC・スマートフォンで検証します。ビルドを `SITE`（既定 `/site`）の `kohako/` に配置し、必要に応じて `PORT` と出力ディレクトリ引数を指定して実行します。

`queue.mjs`（BOXP-508）は token 不要の完全な BFF モックを使い、PC と Pixel 7 相当の送信待ち、FIFO、読み上げ中の追加発言（読み上げを中断しない）、通信切れ時の保留（再接続だけでは送らない）、保留・再開、承認、受理未確認、上限と画面配置を検証します。ビルドを `/site/kohako`、出力先を `/out` に置き、Playwright 1.56.1 で `node queue.mjs /out` を実行します。結果は `result.json` とスクリーンショットに保存され、失敗時は終了コード 1 です。

`usability510.mjs`（BOXP-510）は token 不要の完全な BFF モックで、PC と Pixel 7 相当の Enter 改行・Shift+Enter 送信、Markdown の安全な描画（script・javascript: リンク・画像を無効化し外部通信 0 件）、本文表示中の利用枠ウィジェット非表示、履歴・受信箱の昇順、背景の動きと OS の reduced-motion・「背景を動かす」OFF での静止を確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node usability510.mjs /out` を実行します。

`background512.mjs`（BOXP-512）は BFF を完全にモックし、PC・Pixel 7 相当縦・スマホ横で時間帯と旧背景の表示、動きと各停止条件、連続画像の輝度差、文字のコントラスト、入力・ポインター操作を検証します。PC と Pixel 7 では CDP の処理時間とフレーム間隔も測定します。Playwright 1.56.1 でビルドを `SITE`（既定 `/site`）の `kohako/` に置き、`node background512.mjs /out` を実行します（`PORT` 既定 8795）。結果とスクリーンショットを出力し、assert 失敗または外部通信があれば終了コード 1 です。

`menus512.mjs`（BOXP-512 TD-01）は BFF を完全にモックし、PC・Pixel 7 相当縦・スマホ横でヘッダーと、そこから開くメニュー（読み上げ・ふれあい・受信箱・履歴・設定・Studio リンク）の開閉、Esc、焦点の戻り、スイッチの保存とキーボード操作、受信箱の既読・選択返信・処理済み、履歴の並びと Markdown、面が画面内に収まることを確かめ、各状態の画像を保存します。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node menus512.mjs /out` を実行します（`PORT` 既定 8796、`EMPTY=1` で通知 0 件の状態）。assert 失敗または外部通信があれば終了コード 1 です。

`arms510.mjs`（BOXP-510 TD-02）は（各身振りを `REPEAT` 回（既定 3）位相をずらして再生し、最大の振りの取り逃がしを減らす） token 不要の完全な BFF モックで、腕を動かしたとき左右端で腕・袖が切れないことを最終描画の画素で確かめます。PC（通常・幅縮小・ビューアー表示・履歴表示）と Pixel 7 相当（縦・横・横＋ビューアー・横＋設定）で各身振り（joy / greet / guide / halt / shyHand / tilt / nod）を再生しながら連続でスクリーンショットを撮り、キャラ以外を透明にした画像で描画面（canvas）の左右端の列と画面（舞台）の左右端の列に不透明画素が接していないかを数え、どちらかが 0 でなければ失敗にします。入力欄・送信がキャラの描画面に覆われていないことも確かめます。`BLEED=0` で修正前の余白なし描画面を再現できます（Pixel 7 横などで失敗する）。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node arms510.mjs /out` を実行します。腕が最も外へ出る区間の実画面を `<ケース>-joy.png` / `<ケース>-greet.png` に保存します。

### BOXP-510 PWA

`pwa510.mjs` は SITE の `kohako/` に web ビルドを置き、`node pwa510.mjs /out` で実行します。BFF をローカルで完全にモックし、PC / Pixel 7 相当の manifest、アイコン、SW、キャッシュ、オフライン・復帰、Chromium のインストール可能性を検証します。結果は `/out/result.json` に保存し、失敗時は終了コード 1 を返します。Playwright 1.56.1 を使用します。

アイコンの再生成は `cd apps/kohako-studio/web && npm install --no-save --package-lock=false sharp && node scripts/generate-pwa-icons.mjs`。既存の `c48v6-idle-color.png` から顔を切り出し、nearest-neighbor で拡大します。maskable は 512px 中央の 288px（対角線が直径の 80% 以内） に配置します。

`realpath506.mjs`（BOXP-506 TD-01）は実 BFF の build に合成の Hermes 応答（丁目のない番地の住所・同一行 JSON のブロック・利用枠）を流し、抽出とジオコード（実 Nominatim、出発地は送らない）の結果を出力します。`node realpath506.mjs <bff/dist の絶対パス>`。

`variants510.mjs`（BOXP-510 TD-04）は BFF を完全にモックし、PC と Pixel 7 相当で頭の周りを高解像度で撮影して、全身モデル v11r の照れの頬の赤み（顔の下半分の肌の赤み R-G の中央値が通常より 2 以上増え、通常へ戻すと差 2 未満に戻る）、にっこりの閉じ目（150ms おき 6 枚すべてで青い瞳の画素が通常の 2 割未満。発話の口と頭なでを重ねても閉じたまま）、通常の笑顔・通常へ戻した後は目が開くことを画素から検査します。困りと驚きは通常との差分と青い瞳の画素数の減少、各表情から通常へ戻した後の青画素数の復帰を検査します（差分値も保存）。通常・笑顔・にっこり・照れ・困り・驚き・真剣および各表情から戻した顔画像を保存します。Playwright 1.56.1 でビルドを `SITE`（既定 `/site`）の `kohako/` に置き、`node variants510.mjs /out` を実行します。失敗または外部通信があれば終了コード 1 です。

`attach517.mjs`（BOXP-517）は BFF を完全にモックし、PC と Pixel 7 相当で添付の選択・チップ表示・取消、未対応形式/サイズ超過/PDF 本文なしの明示、添付付き送信（messages に attachments が載る）と履歴の 📎 表示、入力欄・送信が画面内に残ることを確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node attach517.mjs /out` を実行します（`CHROME` で実行ファイルを指定可）。失敗時は終了コード 1 です。

`lookfollow516.mjs`（BOXP-516）は、PC でマウスカーソルの方向へ視線（目と頭の向き）が向くことを**最終描画の瞳（青）の重心**から確かめる回帰検査です。待機クリップも頭を揺らすため、左右・上下を待ち時間をずらしながら交互に 8 回置き直し、まばたき中の枚を除いた平均を比べます（左右 3px・上下 1.5px 以上、控えめは 6 割）。PC 1280×800・横長 1920×900・幅 820 で、四隅の向きが円の内側に収まる（首を伸ばしすぎない）、反対側へ急に動かしても 120ms 以上かけて 1.5 秒以内に向き直る、窓の外へ出る・blur で中立へ戻り再入で再開する、マウスで頭をなでている間は追従が退き 505 の頭の傾きが出る、リサイズ後も左右が合う、設定「カーソルを目で追う」OFF と reduced-motion で追従しない、ペンは画面に触れていない hover だけを追い接触中（押下・押したままの移動）は追従しない、Pixel 7 のタップ・スクロールで追従が有効にならず、なでで頭が傾くことを検査します。外部通信があれば失敗です。`node lookfollow516.mjs <build の dist> <出力先>`（Playwright 1.56.1、BFF は完全にモック、token 不要、`ONLY=pc,wide,narrow,subtle,off,reduced,resize,pen,pixel7` で絞り込み）。各位置・四隅・向き直りの連続フレームの画像と `result.json` を出力先に保存し、失敗があれば終了コード 1 です。

`inboxlayout501.mjs`（BOXP-501）は BFF を完全にモックし、長い日本語・空白のない英数字を含む 20 件の通知について、タブレット縦横・スマホ縦横・PC で先頭・中間・末尾にスクロールし、全カードと題名・種別・日時・状態の包含、重なり、題名の切り詰めを検査します。既読化・選択・閉じる操作と外部通信 0 件も確認し、各位置の画像と `result.json` を保存します。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node inboxlayout501.mjs /out` を実行します（`PORT` 既定 8797）。失敗時は終了コード 1 です。

`dictation524.mjs`（BOXP-524）は token 不要の完全な BFF モックと擬似マイクで、PC と Pixel 7 相当の音声入力（明示クリックの開始・停止・取消、認識文を既存草稿へ追記し自動送信しない、本人の修正後の送信が 1 回だけ）と、認識中の取消で旧結果を捨てる・停止連打で 1 回だけ認識・無音/0.5 秒未満は送らない・権限拒否・非対応ブラウザ・422/502 からの再試行・401 で未認証表示と草稿保持・タブ非表示で破棄とマイク解放、外部通信 0 件を確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node dictation524.mjs /out` を実行します。失敗時は終了コード 1 です。

`peteyes525.mjs`（BOXP-525）は BFF を完全にモックし、PC（実マウス）と Pixel 7（CDP touch）で頭をなでたときの連続描画から、顔周りの青い瞳の画素数（variants510 と同じ指標）で閉眼と復帰を確かめる回帰検査です。なで中（押して動かして 0.7 秒以降）の全フレームが待機最大値の 15% 以下、離して 1.5〜3 秒の最大値が 60% 以上に戻ること、3 回の反復、取消（PC は押したまま描画面の外へ出す／Pixel 7 は touchcancel）で開くこと、hover・頭の tap・手の tap・ふれあい OFF・reduced-motion では閉じないこと、なで中も頭追従（headZ）が残ること、読み上げ中のなででも口形が動き続けることを検査します。`node peteyes525.mjs <build の dist> <出力先>`（Playwright 1.56.1、token 不要）。連続フレームの画像と `result.json` を保存し、失敗があれば終了コード 1 です。`petvisible.mjs` はなで中に目を閉じるようになったため、傾きを瞳の線ではなく頭全体の回転照合で測ります（瞳の線は `eyeTilt` として併記）。

`chest521.mjs`（BOXP-521）は BFF を完全にモックし、胸の揺れ（二次動作）を最終描画の画素で確かめます。Playwright の時計を止めて少しずつ進め、各時刻でキャラの canvas を「揺れを描いたまま」と「同じ瞬間に揺れだけ外して描き直した絵」で読み、胸の範囲の画素のずれ（px）と、胸の外（顔・首・腕・帯・脚）の画素一致を比べます（背景や時計の CSS の動きを拾わないよう、スクリーンショットではなく canvas を読みます）。PC と Pixel 7 相当で、身振り（joy / nod）中に胸が遅れて揺れること（各身振りで 0.5px 以上、少なくとも一つで 0.75px 以上。スマホはキャラの描画が小さいため）、身振りの終わりから 1.5 秒後と待機（触らない）では 0.5px 以内、胸の外の差が 4 画素以内であること、設定「胸の揺れ」OFF・アプリの「動きを減らす」・OS の reduced-motion では変位 0 を確かめ、失敗があれば終了コード 1 にします。`node chest521.mjs <build の dist> <出力先>`（Playwright 1.56.1、token 不要、`ONLY=pc,pixel7,off,reduced,osreduce` で絞れます）。各時刻の胸の拡大（揺れあり／なし）と、0.1 秒ごとに並べた画像（`<ケース>-sheet.png`、上: 揺れあり、下: 揺れなし）を保存します。

`portrait544.mjs`（BOXP-544）は BFF を完全にモックし、縦 3 サイズの各場面・viewer・キーボード表示と PC・横画面を検証します。Playwright 1.56.1 でビルドを `SITE`（既定 `/site`）の `kohako/` に置き、`node portrait544.mjs /out` を実行します（`PORT` 既定 8804）。スクリーンショットと `result.json` を保存し、会話ログ、上半身と頭の当たり判定、カード・ビューアー・入力欄との配置を確認します。`BASELINE=1` は修正前を測るため追加検査を省略します。修正後は `BASELINE_FILE` に修正前の `result.json` を渡すと PC・横画面の主要要素の矩形を比較します。配置異常または外部通信があれば終了コード 1 です。

`mix545.mjs`（BOXP-545）は BFF を完全にモックし、PC と Pixel 7 相当で音楽との重ね合わせ ON/OFF、読み上げの停止・再開、設定の保存を検証します。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node mix545.mjs /out` を実行します。結果は `result.json` に保存し、失敗時は終了コード 1 です。

`inbox547.mjs`（BOXP-547）は BFF を完全にモックし、PC と Pixel 7 相当で通知更新中の返信本文・要素・フォーカス・選択範囲、通知別の下書き、送信先、選択肢と返信済み表示、外部通信 0 件を検証します。更新は `visibilitychange` を発火して行います。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node inbox547.mjs /out` を実行します（`PORT` 既定 8807）。結果は `result.json` に保存し、失敗時は終了コード 1 です。

`percent551.mjs`（BOXP-551）は BFF を完全にモックし、PC で利用枠の使用率が浮動小数の長い小数（exporter の `0.07*100` による `7.000000000000001%` など）で表示されず、小数1桁までに丸めて `Fable専用 7% 正常` のように出ること、リセット後未観測の Fable 窓を 0% にせず `—` とすることを確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node percent551.mjs /out` を実行します（`PORT` 既定 8797）。`EXPECT_FAIL=1` は修正前 build で長い小数が再現することの確認用です。

`activity548.mjs`（BOXP-548）は BFF をモックし、PC と Pixel 7 でツール手順、承認中の操作、完了後の表示、画面内の配置と外部通信を検証します。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node activity548.mjs /out` を実行します（`PORT` 既定 8808）。画像と `result.json` を保存し、失敗時は終了コード 1 です。
