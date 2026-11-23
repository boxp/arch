# PR gate 失敗予算（ticket pool）と run 開始の予約のモデル（BOXP-673）

Task Board runner の **PR gate 失敗予算（ticket ごとの枠、PR 数に応じた上限、grant、PR の除外）と、run 開始時の予約** だけを
小さなモデルにし、そこから「操作の並びと、各操作後にこうなっているはず」を機械的に作って、runner の実際の関数に流して比べる。

- 仕様（日本語の規則・具体例・状態の移り変わりの図）の正本: Obsidian vault の `Projects/task-board-gate-budget/spec.md`。
  規則はそこ（元は `docs/project_docs/BOXP-369`・`448`・`450` の文章）から起こした。実装は「どの関数を呼ぶか」の対応づけにだけ使った。
- 標準の進め方とモデルの足し方: [../MODELS.md](../MODELS.md)
- 結果（検出力、保守の手間）: [docs/project_docs/BOXP-673/plan.md](../../../docs/project_docs/BOXP-673/plan.md)
- 定理の検査、生成物の一致、実装への再生は **merge の必須条件**（[../MODELS.md](../MODELS.md) の「CI」）。

| ファイル | 役割 | 要るもの |
|---|---|---|
| `GateBudgetModel.lean` | モデル（規則）、定理、手順の生成器 | Lean（版は `../lock-model/lean-toolchain`）。外部ライブラリなし |
| `gate-budget-traces.txt.gz` | 生成済みの手順。展開後の 1 行 = `操作列\|各操作後の期待` | なし（生成物。手で編集しない） |
| `../task-board-gate-budget-trace-test.bb` | 手順を runner の実関数に再生して比べる | bb だけ |

## モデルが言っていること

ticket は T1・T2 の 2 件、PR は P1・P2 の 2 件。unit（PR 1 件あたりの枠）は 2
（実装の既定は 10。短い手順で上限に届くよう、実装が許す「下げる方向の設定」で 2 にして再生する）。操作は 20 種:

run の開始・終了（ticket ごと）、gate の合格・失敗（ticket × PR）、追加 grant・旧 grant（ticket ごと）、PR の除外（ticket × PR）。

### 規則と定理の対応

番号は仕様（vault の `Projects/task-board-gate-budget/spec.md`）の規則の番号と同じ。定理はどれも **モデルについて**、全ての状態
（規則 9・10 は全ての操作順・長さ）で成り立つ。実装が規則を守ることは定理からは出ない。それを調べるのは手順の再生だけで、範囲は生成した手順まで。

| # | 規則 | 定理 |
|---|---|---|
| 1 | 失敗の数と grant は、どの操作でも減らない（reset はない） | `never_reset` |
| 2 | 1 つの run が数える失敗は 1 件まで（再処理・別 PR での失敗は数を変えない） | `one_failure_per_run` |
| 3 | 上限 = max(unit × max(1, N), unit + 旧 grant) + 追加 grant。unit を下回らない / 追加 grant は 1 件で 1 増える / 旧 grant は PR 数の分と二重に数えない | `limit_floor` `grant_adds_one` `legacy_is_floor_only` |
| 4 | 上限に達した ticket の run は始まらない | `exhausted_does_not_start` |
| 5 | 枠が残り、動いている run がなく、PR の予約が衝突しなければ run は始まる（PR ごとの失敗数は判定に現れない） | `starts_when_budget_remains` |
| 6 | いちど決まった PR の持ち主は変わらない | `owner_is_permanent` |
| 7 | 除外以外の操作は、どの ticket の上限も下げない | `limit_only_lowered_by_exclusion` |
| 8 | 除外はその ticket の上限を上げず、もう一方の ticket の上限を変えない | `exclusion_only_lowers_own` |
| 9 | 除外が行われない限り、失敗の数は上限を超えない | `never_over_limit`（不変条件 `TkOk`） |
| 10 | 2 つの ticket の run が同じ PR を同時に予約することはない | `reservations_exclusive`（不変条件 `Exclusive`） |

### モデルの操作と実装の対応

再生テストが呼ぶのは runner の実関数で、差し替えるのは時計・保存先・unit の設定値だけ。

| モデルの操作 | 記号 | 再生時に呼ぶ実装 |
|---|---|---|
| run の開始 | `s1` `s2` | `tick!` と同じ関数: `gate-budget-exhausted-for-ticket?`（事前確認）、`acquire-lock!`、`reserve-gate-budget-run!`。予約を断られたら `release-lock!`。`tick!` は事前確認で断ると予約まで進まないが、再生では予約側の判定も毎回通し、事前確認と食い違えば不一致として報告する |
| run の終了 | `e1` `e2` | `release-lock!`（予約は lock が消えると無効になる） |
| gate に合格 | `p1a` … `p2b` | `record-gate-pr-registrations!`（`:ok? true`、`:checked-pr-urls`） |
| gate で失敗 | `f1a` … `f2b` | `record-gate-pr-registrations!` → `record-gate-failure-budget!`（run の終わりの順） |
| 追加 grant | `g1` `g2` | `gate-budget-grant!`（1 件） |
| 旧 grant | `l1` `l2` | BOXP-448 より前の形（`:kind` なし）の grant を予算ファイルへ足す（当時の実装が書いた形を再現。今の実装にこの形を書く関数はない） |
| PR の除外 | `x1a` … `x2b` | `gate-budget-exclude-pr!` |

各操作の後に比べるもの（`期待` の 1 項 = `結果;T1;T2;P1;P2`）:

- 結果: run が始まった、または失敗を処理した後に上限へ達している、なら 1
- ticket ごと: `失敗数/上限/PR数`、上限到達なら `x`、生きている予約があれば `r` と予約した PR（`a` `b`）。読むのは `gate-budget-status` と `gate-budget-reservation-live?`
- PR ごと: その PR での失敗数（全 ticket 合計）と、旧上限に達していれば `L`（記録だけで、開始の判定には使わない）

例: `s1,f1a,e1,s1,f1a|1;0/2/0r;0/2/0;0;0,0;1/2/1r;0/2/0;1;0,0;1/2/1;0/2/0;1;0,1;1/2/1ra;0/2/0;1;0,1;2/2/1xra;0/2/0;2L;0`
（T1 が開始 → P1 で失敗 → 終了 → もう一度開始（今度は P1 を予約）→ 2 回目の失敗で上限 2 に達する）

## モデルが扱わないもの（この方式では見つけられない）

- **同時実行**。手順は 1 操作ずつ順に実行する。2 つの process が同時に予算ファイルを書く場面と `with-gate-failure-budget-lock` の排他そのものは対象外（e2e の並行ケースが見ている）。
- **開始後に知った PR の排他**。予約するのは開始時点で失敗歴のある PR だけ。仕様の穴として vault の仕様に記録した。
- **ticket 本文・Notes が参照する PR**。再生では本文を空として渡す（実装は本文の PR URL も予約の対象にする）。
- **同じ時刻の登録**。再生では 1 操作ごとに時計を 1 秒進める。同時刻だと実装は両方を持ち主にするが、モデルは先着 1 件だけ。
- **lock の期限切れによる予約の失効**。予約が無効になるのは run の終了（lock の解放）だけを扱う。期限切れ・計画停止での回収は `../lock-model/` の対象。
- **停止の報告・Blocked への遷移・失敗の分類**、PR への grant、PR URL の表記ゆれ、unit の設定値の読み方（2 に固定）。
- **自動継続の回数**（`consume-continuation!`）。別のカウンタで、今回は対象にしていない。
- 手順の長さは、初期状態から **最長 5 手**、下の 3 つの出発点から **最長 3 手**。それより長い並びでだけ出る違いは見つからない。
  たとえば「3 つ目の PR」「上限到達 → grant → 再び上限 → もう一度 grant」「両方の ticket が上限に達した後の衝突」は入らない。

## 手順の生成（再現）

```sh
cd tests/codex-workspace/gate-budget-model
lean GateBudgetModel.lean                                   # 定理の検査（通れば何も出ない。2CPU で約 35 秒）
lean --run GateBudgetModel.lean cover 5 | gzip -n -9 > gate-budget-traces.txt.gz   # 手順の生成（約 25 秒、26,034 本・142,239 操作。圧縮後 約 0.11MB）
bb ../task-board-gate-budget-trace-test.bb                  # 再生（約 40 秒、Lean 不要）
```

`cover N` は 2 種類の手順を出す。出力は決定的。

1. 初期状態から N-1 手以内で届く全ての状態について、そこからの 20 操作を 1 回ずつ（意味は `../lock-model/README.md` と同じ）。N = 5 で 22,535 本。
2. **途中の状態から始める手順**（`seeds`）。短い手順では届かない場面を、決めた操作列で作ってから、そこから 2 手以内で届く全ての状態について 20 操作を 1 回ずつ（出発点の後に最長 3 手）。計 3,499 本。
   出発点も初期状態からの操作列なので、再生では実装も同じ操作を実行してその状態に入る（状態を直接書き込まない）。

| 出発点 | 操作列 | 届くようになる場面 |
|---|---|---|
| 両方の ticket が P1 で 1 回ずつ失敗 | `s1,f1a,e1,s2,f2a,e2` | PR の予約の衝突（規則 10）。T1 が P1 を予約して動いている間、T2 は始まらない |
| T1 が上限 2 に達して停止 | `s1,f1a,e1,s1,f1a,e1` | 上限到達後は始まらない（規則 4）、grant・旧 grant の後に 1 回だけ始まり、落ちれば再び止まる（規則 3・5） |
| T1 が PR 2 件の持ち主で 3/4 | `s1,p1b,f1a,e1,s1,f1b,e1,s1,f1a,e1` | PR 数に応じた上限の境界（3 回失敗した後も始まり、4 回目の失敗で上限 4 に達する）、除外で上限が 2 に下がると始まらない（規則 8・4） |

出発点を足した理由: 初期状態から深さ 5 だけでは、PR の予約の衝突（最短 8 手）に届かず、衝突の判定を壊した変異を見逃した。
深さを 6 に上げる案（72,581 本・再生 約 130 秒）でも届かないので、深さではなく出発点で補った。経緯と数字は
[docs/project_docs/BOXP-673/plan.md](../../../docs/project_docs/BOXP-673/plan.md)。

## モデルや実装を変えるとき

1. 先に仕様（vault の `Projects/task-board-gate-budget/spec.md`）の規則・例・図を直す。
2. `GateBudgetModel.lean` の `step` と該当の定理を直し、`lean GateBudgetModel.lean` が warning なしで通ることを確かめる。
3. `gate-budget-traces.txt.gz` を生成し直す。
4. 実装を直し、`bb ../task-board-gate-budget-trace-test.bb` が不一致 0 になることを確かめる。不一致は「操作列・期待・実際」を最短のものから表示する。
5. 規則・対応・対象外が変わったら、この README の表を直す。

## 隔離

再生テストは毎回新しい一時ディレクトリを root と vault にし、runner が環境変数を読む関数を差し替えるので、
シェルに設定された本物の root・vault には触れない。runner のテスト用フック（`CODEX_TASK_BOARD_TEST_*`）が環境にあると実行を拒否する。
