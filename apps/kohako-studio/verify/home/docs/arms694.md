# arms694.mjs（BOXP-694）

`arms694.mjs` は、腕の動き 1 回ぶんを、Playwright の時計を止めて等間隔のコマに切り出し、1 枚の画像に並べます。token 不要の完全な BFF モックです。
1 枚腕への差し替え（0.25 秒のフェード）、曲げた小手の絵への替わり目、外回りの振り上げが水平を通る間など、実時間の動画では数コマしか写らない所を、全部のコマで目で確かめるために使います（合否は出しません。規則は `web/src/live2d/gesture.test.ts`、仕様は vault の `Projects/kohako-home/arm-switch-spec.md`）。

実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node arms694.mjs <build の dist> <出力.png> '<JSON>'`。

- `{"kind":"gesture","name":"greet","emotion":"smile","every":40,"n":18,"cols":6,"fw":300}`: 会話の身振りを 40ms おきに 18 コマ。
- `{"kind":"idle","name":"tidy","every":100,"n":24}`: 待機しぐさ（`playIdle`）。
- `"speak":true`: 話している間の口パクを動かす（アプリが毎コマ呼ぶ `stage.setViseme` と `rig.lipSync` を同じ値で呼ぶ）。
- `"from":3000`: 始めてから 3 秒後のコマから並べる（戻りを見る）。
- `"then":{"at":1000,"gesture":"shyHand"}`: 途中の割込み。`"reset":true`（解除）、`"mouse":true`（マウス移動）も指定できる。
- `BOX="0.4,0.9,1.5,1.9"`: 切り出す範囲（頭の幅・高さを単位に、頭の中心・上端からの x, y, 幅, 高さ）。`"zoom":"arm"` は腰まわり、`"face"` は顔。
