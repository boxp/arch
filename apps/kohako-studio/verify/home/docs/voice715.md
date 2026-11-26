# voice715.mjs（BOXP-715 TD-02）

家の画面で読み上げの声（`VOICE=drama3|kohaku`）を選び、返答の本文（吹き出し・履歴）と音声のどちらが止まるかを時刻つきで記録する。

- 返答本文は会話 API（`messages` / `requests/*`）を固定応答にして Hermes の待ちを切り離す。TTS は配備中 BFF へ検証用 token で中継して実合成する。
- `SITE` を指定するとローカル build の HTML/JS を使い、無いファイル（Live2D 資産など）は配備版から取る。未指定なら配備版。
- 出力: `<outdir>/voice715-<voice>-<mode>.json`（`first.textVisible` / `first.firstAudio` / `first.speakingEnded`、TTS 要求ごとの送信・完了・status）と画面写真。token は出力しない。
- 実行: Playwright 1.56.1 コンテナで `TOKEN_FILE=... VOICE=drama3 node voice715.mjs /out`。
