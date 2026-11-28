# dolls766.mjs（BOXP-766）

家の人形（作業中の AI モデル）を PC（1440x900）とスマホ縦（390x844）で開き、次を確かめて `<出力dir>/result.json` と画面写しに残します。

- 人形の数（PC 5 体・スマホ 3 体＋「+N」）、絵が読めたか、押せる大きさ（44px 以上）、画面の外へ出ないか、吹き出し・入力欄・送信・停止・確認・札と重ならないか
- 1 体目を押した時のカード（担当名・実行モデル・票・最新の記録・状況・取得時刻）、Notes が HTML として解釈されないこと、Esc で閉じること
- ページのエラー、ページの外への通信、4xx/5xx

```
PW_WS=ws://127.0.0.1:<port>/ node dolls766.mjs out/local ../../web/dist          # 手元 build・API は見本
PW_WS=ws://127.0.0.1:<port>/ BASE=http://<Service>/kohako/home.html TOKEN_FILE=<token> node dolls766.mjs out/deployed   # 配備版
```

配備版では検証用 token（audience `kohako-bff-verifier`）を API にだけ付けます。結果には Notes の本文を書かず、文字数だけ残します。スマホ縦は吹き出しを閉じた状態を作ってから見ます。
