# keshin716.mjs（BOXP-716）

`keshin716.mjs` は、Keshin2D の試作（候補 `keshin-273db9f` の `keshin.html`）と通常版の家（`home.html`）を、同じ台本・同じ画面の大きさ・通常の速さで録画します。合否は出さず、録画と時刻を出します。token 不要の完全な BFF モック（送信は受理 → 3 回目の照会で模擬の返事）。仕様は vault の `Projects/kohako-home/keshin2d-trial-716.md` の K3。

実行: Playwright 1.56.1 で `PW_WS=ws://host:port/ node keshin716.mjs <候補の版の build の dist> <出力先> [A|B|phone]`（指定なしは全部）。候補の版（`candidates/src/keshin-273db9f/web` を build したもの）には通常版と同じ `home.html` も入っているので、1 つの build で両方を録れます。

- `A`: 立ち姿の待機 → 4 秒で送信 → 返事 → 話し終わって 3 秒。家で測った「考えている」「話している」の時刻を、試作の「台本A」へそのまま渡す。
- `B`: 座り切って 2 秒後から、マウスを 左 → 右 → 上 → まん中 へ 2 秒ずつ（PC 1280x800）。家は `playSeat('sit')`、試作は「台本B」。
- `phone`: 390x844（タッチ）で `A`。
- 出力: `<台本>-home.webm`・`<台本>-keshin.webm`、各時刻と閉じるまでの実時間（録画の伸びを直すため）の `meta.json`。左右に並べるのは `compose716.mjs`。検証メディアは vault に置かない（`/home/boxp/verification-artifacts/<TICKET>/<label>/`）。

見ていないもの: 見た目の自然さ（本人の判断）、実機の GPU・スマホ、ログインした状態の実際の会話。
