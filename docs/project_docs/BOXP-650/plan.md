# BOXP-650: lock と停止・再開のモデルから手順を生成する限定試行

前段: BOXP-649（調査。vault `Projects/lean-spec-driven-testing/`）/ [BOXP-616](../BOXP-616/plan.md)（変異テストの道具）

## 結論

- 調査で決めた採否の目安は **2 つとも満たした**。
  - 既存テストが見逃す欠陥: わざと入れた欠陥 102 件のうち **10 件** を、既存テストは見逃し、生成した手順は検出した。
  - 変更 1 回の手間: モデルに規則を 1 つ足す変更が **14 分以内**（目安は 30 分以内）。
- 本物の runner との食い違いは **0 件**。実際の不具合は見つかっていない。
- 逆に、既存テストが検出して生成した手順が見逃した欠陥も 5 件ある。置き換えではなく上乗せ。
- 目安を満たしたので Lean を外す整理はせず、合否に影響しない CI のまま置く。対象を広げる・必須にするのは別の判断。

## 何をどこまでやったか

対象は Task Board runner の 1 か所だけ: **ticket lock（取得・heartbeat・解放・期限切れの回収）と、
計画停止の印・再起動時の回収・印の保存期限**。runner 全体のモデル化、必須の CI、他の箇所への展開はしていない。

| 置いたもの | 中身 |
|---|---|
| `tests/codex-workspace/lock-model/LockModel.lean` | モデル（394 行）、定理 9 件、手順の生成器 |
| `tests/codex-workspace/lock-model/lock-traces.txt` | 生成済みの手順 24,207 本（116,697 操作、約 2.4MB） |
| `tests/codex-workspace/lock-model/README.md` | 規則と定理の対応、モデルの操作と実装の対応、対象外、再生成の手順 |
| `tests/codex-workspace/task-board-lock-trace-test.bb` | 手順を runner の実関数に再生して比べる（bb だけで動く、約 25 秒） |
| `task_board_runner.bb` | heartbeat の 1 回分を `heartbeat-once!` に切り出した（挙動は同じ）。他は変えていない |
| CI（2 つとも合否に影響しない） | `lock-trace`: 手順の再生。`Test Task Board Lock Model`: 証明の検査と、手順がモデルから作り直したものと同じか（モデルを変えた PR だけ） |

普段のテストは Lean を使わない。Lean が要るのはモデルを変えて手順を作り直すときだけ。

## 検出力の比較

### 測り方

BOXP-616 の変異テストの道具（`task-board-mutation.bb`）で、lock と停止・再開に関わる **26 関数** の式を 1 か所ずつ
変えた **102 件** を作り、同じ 102 件を 2 通りのテストで判定した。変異は道具が作る隔離コピーの中だけで、
checkout・稼働中の runner・実際の vault と lock には書いていない。

- **既存**: 直接テスト 2 本（`task-board-runner-boundary-test.bb`、`task-board-same-file-review-test.bb`）と、
  e2e 177 ケースのうち lock・計画停止を扱う 18 ケース（ケース名で選んだ）。
- **生成した手順**: `task-board-lock-trace-test.bb` だけ。

対象の関数: `stale-lock?` `current-runner-lock?` `same-ticket-lock?` `delete-lock-if-matches-under-guard!`
`cleanup-stale-locks!` `create-lock-under-guard!` `acquire-lock!` `heartbeat-once!`
`owner-accepting-locks-under-guard?` `owner-instance-for-lock-under-guard` `stopping-owner-state?`
`current-runner-marker?` `current-owner-marker?` `previous-runner-marker?` `matching-shutdown-marker`
`same-shutdown-marker?` `matching-shutdown-lock-exists?` `retire-owner-under-guard!` `expired-shutdown-marker?`
`recover-planned-shutdown-marker!` `recover-planned-shutdown-locks!` `recover-locks!` `prepare-shutdown!`
`activate-owner!` `read-shutdown-markers` `close-interrupted-lock!`

### 結果

| | 検出 | 見逃し | 検出率 | 所要（1 並列） |
|---|---|---|---|---|
| 既存（直接 2 本 + e2e 18 ケース） | 72 | 30 | 70.6% | 54 分 |
| 生成した手順 | 77 | 25 | 75.5% | 56 分 |
| どちらかが検出 | 82 | 20 | 80.4% | |

| 内訳 | 件数 |
|---|---|
| 両方が検出 | 67 |
| **既存は見逃し、生成した手順が検出** | **10** |
| 既存が検出、生成した手順は見逃し | 5 |
| 両方が見逃し | 20 |

### 既存は見逃し、生成した手順が検出した 10 件

どれも本物の runner の不具合ではなく、「この規則を壊しても既存テストは気付かない」という穴。

| 関数 | 変異 | 壊れる規則 |
|---|---|---|
| `current-runner-lock?` | 3 件（`and`→`or`、`=`→`not=` 2 件） | 自分の今の process の lock は、期限切れでも自分では奪わない（規則 5）。壊れると、heartbeat が 180 秒遅れた run の lock を同じ runner が回収し、同じチケットを二重に始めうる |
| `acquire-lock!` | 1747 行 `(not x)`→`x` | 同上（取得時の判定） |
| `acquire-lock!` | 1750 行 `or`→`and` | 期限切れの lock を回収して取り直したのに「取れなかった」と返す。lock ファイルだけ残る |
| `heartbeat-once!` | `false`→`true` | lock が他へ移ったのに heartbeat が成功を返す（規則 2）。壊れると古い run が止まらない |
| `owner-accepting-locks-under-guard?` | `and`→`or` | 停止を始めた owner は取得できない（規則 4）。印だけ・状態だけの片方で通ってしまう |
| `current-runner-marker?` | `=`→`not=` | 起動時に、自分の今の process の印を回収対象から外す |
| `previous-runner-marker?` | `and`→`or` | 起動時に空の印を片付けてよいのは、同じ owner の前の process の印だけ（他 owner の印は遅れて来る lock のために残す） |
| `recover-planned-shutdown-locks!` | 1704 行 `and`→`or` | 同上（起動時でない回収では空の印を片付けない） |

この 10 件を e2e の全ケースでも見逃すかは確認中（結果をここに追記する）。

### 既存が検出し、生成した手順が見逃した 5 件

| 関数 | 変異 | 見逃した理由 |
|---|---|---|
| `owner-instance-for-lock-under-guard` | 2 件 | 状態ファイルと process の世代がずれた場合の分岐。モデルの対象外（README） |
| `prepare-shutdown!` | 2 件（`or` の予備の値） | 状態ファイルが無い・host が無いときの予備。モデルは状態ファイルが必ずある所から始まる |
| `recover-planned-shutdown-marker!` | 1669 行 `when`→`when-not` | 回収の途中で 2 つ目の lock が来る場面（同時実行）。モデルの対象外 |

### 両方が見逃した 20 件

`owner-instance-for-lock-under-guard` 6、`acquire-lock!` 2、`prepare-shutdown!` 1、`activate-owner!` 1、
`cleanup-stale-locks!` 1、`expired-shutdown-marker?` 1（境界 `>`→`>=`）、`matching-shutdown-lock-exists?` 1、
`read-shutdown-markers` 1、`recover-locks!` 1、`recover-planned-shutdown-locks!` 1、
`recover-planned-shutdown-marker!` 1、`retire-owner-under-guard!` 1、`same-shutdown-marker?` 1、`stopping-owner-state?` 1。
挙動が変わらない変異（等価）と本当の穴を 1 件ずつ読み分けてはいない。今回テストも足していない。

### 本物の runner との食い違い

手順 24,207 本を今の runner に再生して **不一致 0**（保存期限を足す前の 8,477 本でも 0）。
モデルは担当（AI）が実装を読んで書いたので、0 件は「実装が正しい」ことの独立した証拠ではない。

## 保守の手間

モデルの変更を 1 回、実際にやって測った: **計画停止の印の保存期限（3600 秒）をモデルに足す**。
状態に「印を書いた時刻」を足し、回収の規則に期限切れを足し、時計の操作に 3601 秒を足し、定理を 1 件（規則 9）足し、
壊れた既存の証明 3 か所を直し、手順を作り直し、再生して不一致 0 を確かめ、README を直すまで。

- 所要: **14 分以内**。作業が run の中断をまたいだため、前半は commit 時刻から中断時刻までの上限（11 分 17 秒）、
  後半は実測（2 分 27 秒）。目安の 30 分以内。
- 差分: モデル 38 行追加・14 行削除、README 7 か所、再生テストは変更なし（時計の操作は秒数を読むだけなので）。
- 待ち時間: 証明の検査 53 秒、手順の生成 39 秒、再生 24 秒（2CPU）。
- 手間として見えたもの:
  - 既存の証明が 3 か所壊れた（状態の項目を足したため）。直したのは AI で、人が Lean を直す前提では測っていない。
  - 生成ファイルが 0.8MB → 2.4MB、手順が 8,477 → 24,207 本になった。時刻が状態に入ると状態の数が増える。
    モデルを変えるたびに MB 単位の差分がリポジトリに入る。
  - Lean の道具一式は約 3GB。CI では毎回ダウンロードする（モデルを変えた PR だけ、約 1 分半）。

測ったのは 1 回、1 種類の変更だけ。実装の挙動を変える変更（モデルと実装を両方直す）は測っていない。

## 採否の評価

調査（BOXP-649）で決めた目安と結果:

| 目安 | 結果 | 判定 |
|---|---|---|
| 既存テストが見逃す欠陥、または実際の不具合を 1 件以上見つける | 見逃す欠陥 10 件（実際の不具合は 0 件） | 満たす |
| 変更 1 回の手間が 30 分以内 | 14 分以内（1 回の実測） | 満たす |

満たさない場合の「Lean を外して Babashka の全列挙だけ残す」整理は行わない。ただし次は分けて読む必要がある。

- 10 件を検出したのは「モデルから期待結果つきの手順を全部作って実装に流す」部分で、Lean の証明ではない。
  証明が実装の欠陥を見つけた例は今回ない。同じモデルを Babashka で書いても同じ手順は作れる。
  Lean で書く利点として確認できたのは、規則 9 件が全ての状態で成り立つとモデルについて検査できること、
  モデルを変えたときに壊れた規則がその場で分かること（今回 3 か所）。
- 既存テストの穴 10 件は、e2e や直接テストを足しても埋められる種類のもの。手順の生成でなければ見つからなかった、
  とは言えない。

## 未確認

- 実際の不具合を見つける力。今回は 0 件で、あるともないとも言えない。
- 2 つの process が同時に動く場面、heartbeat のループ、壊れたファイル、複数チケット。モデルの対象外（README）。
- 5 手を超える並びでだけ出る違い。印の保存期限ちょうど（3600 秒）の境界。
- 人が Lean のモデルを読んで直す場合の手間。実装の挙動を変える変更の手間。長期の保守。
- 両方が見逃した 20 件の読み分け。

## 再現

```sh
# 手順の再生（Lean 不要）
bb tests/codex-workspace/task-board-lock-trace-test.bb

# モデルの検査と手順の作り直し（Lean 4.36.0）: tests/codex-workspace/lock-model/README.md

# 検出力の比較（隔離コピー上。関数ごとに数分〜十数分）
bb tests/codex-workspace/task-board-mutation.bb --config CFG --fn FN --jobs 1 --out DIR
```

比較に使った設定（`cfg-existing.edn` / `cfg-trace.edn`）、変異ごとの結果、集計は
`/home/boxp/verification-artifacts/BOXP-650/mutation/` に置いた（リポジトリには入れていない）。
