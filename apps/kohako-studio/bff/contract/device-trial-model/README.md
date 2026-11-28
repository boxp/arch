# 端末へ 1 タップで地図を開く試験の依頼のモデル（BOXP-752）

コハコの家の「家から本人の端末へ Web Push を送り、通知のタップで決まった公開施設の地図を 1 回だけ開く」試験について、依頼の状態の決まりを仕様から起こした Lean のモデルです。実装の写しではありません。
仕様は Obsidian の `Projects/kohako-device-delegation/trial-spec.md`（spec_feature: `kohako-device-trial`）の「決まり」2・4・5・6。

モデルの状態は、停止スイッチと、作った順の依頼（状態: 待ち・開いた・期限切れ・取消、期限を過ぎたかの印）。
操作は、作る・依頼 i を開く・依頼 i をやめる・停止・解除・期限が過ぎる（tick: その時にある依頼すべての期限が過ぎる）・再起動。

## 仕様の規則と定理の対応

| 仕様の規則 | 定理 |
| --- | --- |
| 決まり 2・6: どの操作の後も、停止中は待ちが無く、待ちは高々 1 件 | `good_init`・`good_step`・`good_run`（`Good`） |
| 決まり 2: 停止中は依頼を作らない | `create_stopped` |
| 決まり 4: 開くが成功するのは、待ちで期限内の時だけ | `open_ok` |
| 決まり 4: 開いた後は、どんな並びの後でも同じ依頼をもう一度開けない | `open_once` |
| 決まり 4・5・6: 終わった依頼（開いた・期限切れ・取消）は、どの操作でも変わらない（解除しても取消は戻らない） | `final_stays`・`final_stays_run` |
| 決まり 5: 期限の時にあった依頼は、その後どの順で操作しても開けない | `late_never_opens`（`late_stays`・`late_stays_run`） |

## 実装との対応

- `bff/src/device-trial.ts` の `create`・`open`・`cancel`・`setStopped` がモデルの `create`・`openR`・`cancel`・`stop`/`resume`。期限は時計で判定し（作ってから 2 分）、見た時に期限切れにする（モデルの `norm`）。再起動は保存された記録から作り直す。
- `bff/src/device-trial.test.ts` の「モデルの並び」のテストが、`cases.txt`（依頼 0〜2 を指す 11 種の操作の、長さ 4 までの全ての並び 16,104 本）を実装に流し、各操作の結果と、並びの後の停止・各依頼の状態を照合する。tick は時計を 121 秒進める。
- `cases.txt` の 1 行: `並び 各操作の結果 停止 各依頼の状態`。並びの記号は C=作る、O0〜O2=依頼 0〜2 を開く、X0〜X2=やめる、S=停止、U=解除、T=期限が過ぎる、R=再起動。結果は ok/stopped/exists/opened/expired/cancelled/none、状態は P/O/E/X（待ち・開いた・期限切れ・取消）。

3 つの主張は別です: 仕様が正しい / モデルの証明が成り立つ / 実装は、列挙した並びの上でだけモデルと一致した。

## 検査と生成

```sh
lean DeviceTrialModel.lean                     # 証明の検査
lean --run DeviceTrialModel.lean > cases.txt   # 操作の並びの生成
```

CI: `.github/workflows/test-kohako-device-trial-model.yml`（証明・sorry/公理なし・`cases.txt` が生成結果と同じ）。照合は bff の unit test（Docker build 内）で常に走る。

## 省いたもの

- 1 時間 10 件の上限（決まり 2 の `too_many`）。並びは 4 件以下しか作らないので効かない。上限は仕様の例 10 の unit test で確かめる。
- 時刻の細部。期限は「過ぎた・過ぎていない」の 2 値で、tick はその時にある依頼すべてを過ぎたことにする（待ちは高々 1 件なので、別々の期限を持つ待ちが同時にある場面は無い）。期限ちょうどの扱いは unit test で確かめる。
- 行き先の種類（モデルの依頼は行き先を持たない）、Push の送信の成否、履歴の 50 件の上限、秒数・経路の記録。
- 本当の並行。実装は操作を 1 本の待ち行列で 1 つずつ行う。BFF が 2 つ以上動くこと、保存の書き込みの失敗。
- 端末側（Service Worker・ブラウザ・地図アプリ）の動き。SW の判定は web の unit test、実機の動きは本人の確認。
