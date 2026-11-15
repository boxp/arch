# background512.mjs（BOXP-512）

`background512.mjs`（BOXP-512）は BFF を完全にモックし、PC・Pixel 7 相当縦・スマホ横で時間帯と旧背景の表示、動きと各停止条件、連続画像の輝度差、文字のコントラスト、入力・ポインター操作を検証します。PC と Pixel 7 では CDP の処理時間とフレーム間隔も測定します。Playwright 1.56.1 でビルドを `SITE`（既定 `/site`）の `kohako/` に置き、`node background512.mjs /out` を実行します（`PORT` 既定 8795）。結果とスクリーンショットを出力し、assert 失敗または外部通信があれば終了コード 1 です。
