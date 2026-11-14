# portrait544.mjs（BOXP-544）

`portrait544.mjs`（BOXP-544）は BFF を完全にモックし、縦 3 サイズの各場面・viewer・キーボード表示と PC・横画面を検証します。Playwright 1.56.1 でビルドを `SITE`（既定 `/site`）の `kohako/` に置き、`node portrait544.mjs /out` を実行します（`PORT` 既定 8804）。スクリーンショットと `result.json` を保存し、会話ログ、上半身と頭の当たり判定、カード・ビューアー・入力欄との配置を確認します。`BASELINE=1` は修正前を測るため追加検査を省略します。修正後は `BASELINE_FILE` に修正前の `result.json` を渡すと PC・横画面の主要要素の矩形を比較します。配置異常または外部通信があれば終了コード 1 です。
