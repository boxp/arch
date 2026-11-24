# seat698.mjs（BOXP-698）

`seat698.mjs` は、試作候補「浮く椅子に腰かける」（`web/src/home/seat.ts`・`web/src/live2d/seat.ts` を含む版）を実ブラウザで確かめます。token 不要の完全な BFF モックです。通常版（main）の build には座る動きが無いので、候補の版の build（`candidates/src/<id>/web` を build したもの、または配備版の `/kohako/candidates/<id>/` を取り出したもの）に対して使います。仕様は vault の `Projects/kohako-home/seat-spec.md`。

実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node seat698.mjs <build の dist> <出力先> [check|sheets|record]`（指定なしは全部）。

- `check`: 時計を止めて規則を確かめる。座る流れ（椅子が先・座り具合が戻らない・約 1.25 秒）、足が約 146 上がる、座っている間も待機のしぐさが出る・マウスで立たない、足のぶらぶらと浮き沈み、自分から立つ（約 1.3 秒、足と体が元の位置へ戻る）、話しかけたら 0.45 秒以内に立ち姿・0.65 秒以内に椅子が消える（座る途中でも）、非表示から戻ると立ち姿、設定 OFF／動きを減らす／OS の動きを減らす／`?seat=off`／縦長の画面（上半身だけの枠）では座らない、何も指定しなければ 20〜40 秒（＋しぐさ待ち）で最初に座る。失敗があれば終了コード 1。
- `BASE=<変更前の dist>` を渡すと、座っていない間の画面の切り抜きが変更前と画素一致することも確かめる。
- `sheets`: 立ち姿・座る流れ・座り切り・足のぶらぶら・手を前でそろえる・自分から立つ・話しかけて急いで立つ を、コマの一覧（`*.png`）にする。目で見るためのもので、合否は出さない。
- `record`: 実時間の動画（時計は止めない、`?seat=now`）。`01-sit-seated-stand.webm`（座る → 座っている → マウス → 立つ）、`02-sit-talk-stand.webm`（座る → 話しかけて立つ）と、出来事の時刻の `recording-meta.json`。画面は家の画面そのまま（API は模擬、未ログイン）。
- 結果は `<出力先>/seat698.json`。検証メディアは vault に置かない（`/home/boxp/verification-artifacts/<TICKET>/<label>/`）。

見ていないもの: 見た目の自然さ・かわいさ（本人の判断）、実機の GPU・スマホ、ログインした状態での実際の会話との並び。
