# percent551.mjs（BOXP-551）

`percent551.mjs`（BOXP-551）は BFF を完全にモックし、PC で利用枠の使用率が浮動小数の長い小数（exporter の `0.07*100` による `7.000000000000001%` など）で表示されず、小数1桁までに丸めて `Fable専用 7% 正常` のように出ること、リセット後未観測の Fable 窓を 0% にせず `—` とすることを確かめます。ビルドを `SITE`（既定 `/site`）の `kohako/` に置き、Playwright 1.56.1 で `node percent551.mjs /out` を実行します（`PORT` 既定 8797）。`EXPECT_FAIL=1` は修正前 build で長い小数が再現することの確認用です。
