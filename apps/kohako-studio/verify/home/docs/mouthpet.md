# mouthpet.mjs

`mouthpet.mjs` はローカル build と完全な BFF モックで、無音再生中の推定口形と PC / Pixel 7 の頭追従を記録します。Playwright 1.56.1 の node_modules を /pw、build を /site/kohako、出力先を /out に置いて実行します。動きを減らす設定では口の幅変形と頭追従を無効にし、口の開閉のみ残します。口形は文字ベースの近似で、漢字の読みや実際の音素は認識しません。
