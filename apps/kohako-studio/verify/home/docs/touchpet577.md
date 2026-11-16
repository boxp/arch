# touchpet577.mjs（BOXP-577）

`touchpet577.mjs` は、スマホ・タブレットで指で頭をなでたときの回帰検査です（Chromium の CDP touch、BFF は完全にモック、token 不要）。
iPhone 15（縦・横）、iPad Pro 11（縦・横）、Pixel 7、Galaxy Tab S4 で、頭の中央から横・縦・斜めに往復、頭の矩形の上・右の 8px 外側（指の判定の内側）から往復、途中で取り消し（touchCancel）を行い、
なで中は頭が 3° 以上寄って目を閉じる、離す／取り消すと 0.1 秒後に目が開き 4 秒以内に頭が戻る、頭の上の指はスクロールを止めて pointercancel にならない、頭の外（体）から始めた指はスクロールを止めない、を確かめます。
PC（マウス）では、頭の上のなでが従来どおり動き、頭の矩形の外では反応しないこと（指の広い判定がマウスに効かないこと）を確かめます。

`node touchpet577.mjs <build の dist> <出力先>`（Playwright 1.56.1）。`DEVS='iPhone 15,Pixel 7'` で端末を絞れます。失敗があれば終了コード 1。各端末の画面と `touchpet577.json` を出力先に保存します。
