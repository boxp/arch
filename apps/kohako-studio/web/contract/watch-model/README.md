# 画面を一緒に見て呼びかけに返事する試作の状態のモデル（BOXP-779）

コハコの家の「📺 一緒に見る」（`home.html?watch=1`）について、状態と出来事の順序の決まりを仕様から起こした Lean のモデルです。実装の写しではありません。
仕様は Obsidian の `Projects/kohako-home/watch-together-spec.md`（spec_feature: `kohako-home-watch-together`）の「決まり」1・3・5・7・8 と状態遷移。

モデルの状態は off・starting・watching・transcribing・asking・replying の 6 つ。出来事は、本人の開始・停止、発話の区切れ、非同期の結果（取得できた・失敗・認識結果・返事・読み上げ終わり）。非同期の結果は「今の回のもの（fresh）」か「止める前の回の遅れたもの」かを持ちます。

## 仕様の規則と定理の対応

| 仕様の規則 | 定理 |
| --- | --- |
| 決まり 1: 取得を求めるのは off で本人が始めた時だけ | `acquire_only_on_start` |
| 決まり 3・5: 送るのは、聞き取り中に今の回の「呼びかけあり」が届いた時だけ | `send_only_on_call`・`no_call_no_send` |
| 決まり 3: 認識へ送るのは待機中に発話が区切れた時だけ（同時に 1 件） | `transcribe_only_watching` |
| 決まり 7: 読み上げるのは返事待ちに今の回の返事が届いた時だけ／返事待ちへ入るのは送った時だけ／返事待ち・返事中は新しく送らない | `speak_only_when_asking`・`asking_by_send`・`no_send_while_busy` |
| 決まり 8: どの状態からでも止めると off、動いていれば取得を手放す | `stop_always`・`stop_releases` |
| 決まり 8: 遅れた結果では何も変わらない | `stale_ignored` |
| 決まり 1・8: 止めた後は、本人が再び始めるまでどんな並びでも off のまま何もしない | `off_silent`・`stopped_stays_silent` |

## 実装との対応

- `web/src/home/watch.ts` の `watchStep` がモデルの `step`。回の番号（`gen`）は開始のたびに 1 増え、非同期の結果は始めた回の番号を持つ。番号が今の回と同じならモデルの fresh、違えば遅れた結果。
- `web/src/home/watch.test.ts` の「Lean モデルの全ての並び」のテストが `cases.txt`（12 種の出来事の長さ 4 までの全ての並び 22,620 本）を `watchStep` に流し、各出来事の効果と最後の状態を照合する。fresh の結果は今の番号、遅れた結果は今の番号 − 1 で渡す。
- `cases.txt` の 1 行: `並び 各出来事の効果 最後の状態`。記号は S=開始、X=停止、U=発話の区切れ、R=取得できた、F=失敗、Y=呼びかけあり、B=呼びかけありだが通常会話の応答待ち、N=呼びかけ無し、A=返事、D=読み上げ終わり、y=遅れた「呼びかけあり」、a=遅れた返事。

3 つの主張は別です: 仕様が正しい / モデルの証明が成り立つ / 実装（`watchStep`）は、列挙した並びの上でだけモデルと一致した。

## 検査と生成

```sh
lean WatchModel.lean                     # 証明の検査
lean --run WatchModel.lean > cases.txt   # 操作の並びの生成
```

CI: `.github/workflows/test-kohako-watch-model.yml`（証明・sorry/公理なし・`cases.txt` が生成結果と同じ）。照合は web の unit test（Docker build 内）で常に走る。

## 省いたもの

- 画面の中の配線（`main.ts`）。マイクの音の処理・静止画の取得・送信・返事の受け取りが、正しく `watchStep` へ出来事を渡しているかはモデルの外で、模擬のブラウザでの確認（`verify/home/watch779.mjs`）が受け持つ。
- 呼びかけの判定・発話の区切り・静止画の大きさ（仕様の例から作った unit test で確かめる）。
- 本当の並行性（音声処理のコールバックと通信の完了が同時に起きる場面）。モデルは 1 本の並びだけを扱う。
- 共有の終了（ブラウザの停止・マイクの切断）は停止と同じ出来事として扱う。
- 長さ 5 以上の並び（照合）。証明は長さによらない。
