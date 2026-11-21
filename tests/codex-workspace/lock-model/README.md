# ticket lock と計画停止・再起動のモデル（BOXP-650 限定試行）

Task Board runner の **ticket lock（取得・heartbeat・解放・期限切れ回収）と、計画停止の印・再起動時の回収** だけを
小さなモデルにし、そこから「操作の並びと、各操作後にこうなっているはず」を機械的に作って、runner の実際の関数に流して比べる。

- 試行の結果と採否の評価: [docs/project_docs/BOXP-650/plan.md](../../../docs/project_docs/BOXP-650/plan.md)
- 定理の検査と「`lock-traces.txt.gz` がモデルから作り直したものと同じか」は **merge の必須条件**（BOXP-652。下の「merge の必須条件」）。
- 手順の再生（`lock-trace`）は合否に影響しない CI のまま。普段のテストは Lean なしで動く（生成済みの手順 `lock-traces.txt.gz` を読むだけ）。

| ファイル | 役割 | 要るもの |
|---|---|---|
| `LockModel.lean` | モデル（規則）、定理、手順の生成器 | Lean 4.36.0（`lean-toolchain`）。外部ライブラリなし |
| `lean-linux.tar.zst.sha256` | CI が入れる Lean（`lean-<版>-linux.tar.zst`）の sha256。`lean-toolchain` と一緒に変える | なし |
| `lock-traces.txt.gz` | 生成済みの手順を gzip で圧縮したもの。展開後の 1 行 = `操作列\|各操作後の期待` | なし（生成物。手で編集しない） |
| `../task-board-lock-trace-test.bb` | 手順を runner の実関数に再生して比べる | bb だけ |

## モデルが言っていること

owner（runner の Pod）は A・B の 2 つ、チケットは 1 件。操作は 15 種:
取得・heartbeat・解放・回収・計画停止・再起動（それぞれ A・B）と、時計を 90 秒 / 91 秒 / 3601 秒進める。
lock の期限は 180 秒なので、90+90 は「ちょうど期限（まだ有効）」、90+91 は「期限切れ」になる。
計画停止の印の保存期限は 3600 秒（既定値）で、3601 秒進めると期限を超える。

### 規則と定理の対応

`LockModel.lean` の定理は次の規則と 1 対 1。定理はどれも **モデルについて**、全ての状態（規則 7 は全ての操作順・長さ）で成り立つ。
実装が規則を守ることは定理からは出ない。それを調べるのは手順の再生だけで、範囲は生成した手順まで。

| # | 規則 | 定理 |
|---|---|---|
| 1 | 期限内で、持ち主に計画停止の印がない lock は、誰の取得・回収・再起動でも変わらない | `fresh_unmarked_lock_survives` |
| 2 | heartbeat が書き換えるのは、その process が開始してまだ終えていない実行の lock だけ | `beat_changes_only_own_run` |
| 3 | 解放が消すのは、終わる実行自身の lock だけ | `release_removes_only_own_run` |
| 4 | 停止を始めた owner（印がある、または状態が active でない）の取得は何も変えない | `stopping_owner_cannot_acquire` |
| 5 | 自分の今の process の lock は、期限切れでも自分の取得・回収では奪わない | `own_lock_not_reclaimed_by_self` |
| 6 | 持ち主の計画停止の印と世代が一致する lock は、期限を待たずに回収される（他 owner の回収・他 owner の再起動・持ち主自身の再起動のどれでも） | `marked_lock_recovered` |
| 7 | 状態ファイルの世代は今の process の世代で、印があればその世代を指し、印がある間は active でない。lock の世代・番号・時刻は現在を超えない | `good_reachable`（不変条件 `Good`） |
| 8 | 再起動した owner は必ず lock を取れる状態（印なし・active）に戻る | `restart_resumes` |
| 9 | 保存期限を超えた計画停止の印は、一致する lock がなければ、他の owner の回収で片付き、印の owner は terminated になる | `expired_marker_retired` |

### モデルの操作と実装の対応

再生テストが呼ぶのは runner の実関数で、差し替えるのは時計・保存先・「どの owner のどの process が呼んでいるか」だけ。

| モデルの操作 | 記号 | 再生時に呼ぶ実装 |
|---|---|---|
| 取得 | `aA` `aB` | `acquire-lock!` |
| heartbeat 1 回 | `bA` `bB` | `heartbeat-once!`（process が持つ未完了の実行それぞれについて 1 回） |
| 解放 | `rA` `rB` | `release-lock!`（process の最も古い未完了の実行） |
| 回収 | `cA` `cB` | `recover-locks!`（tick の先頭と同じ。計画停止の回収 → 期限切れの回収） |
| 計画停止 | `sA` `sB` | `prepare-shutdown!` |
| 再起動 | `RA` `RB` | 新しい instance id で `(recover-locks! true)` → `activate-owner!`（`loop!` の起動順） |
| 時計 | `t90` `t91` `t3601` | `now` を進める |

各操作の後に比べるもの（`期待` の 1 項 = `結果;lock;A;B`）:

- 結果: 取得できた・heartbeat を書いた・自分の lock を消した、なら 1
- lock ファイル: `持ち主 世代.付与の通し番号.heartbeat の時刻`、なければ `-`
- owner ごと: 状態ファイルの世代と状態（`a` active / `t` terminating / `x` terminated）、
  計画停止の印（`m世代`、なければ `-`）、process が持つ未完了の実行の番号

例（ある行の先頭 3 手）: `aA,sA,cB|1;A0.0.0;0a-0;0a--,0;A0.0.0;0tm00;0a--,0;-;0x-0;0a--`
（A が取得 → A が計画停止 → B の回収で、A の lock は期限を待たず消え、A は terminated になり印が消える）

## モデルが扱わないもの（この試行では見つけられない）

- **同時実行**。手順は 1 操作ずつ順に実行する。2 つの process が同時にファイルを取り合う場面、
  `with-ticket-lock-guard` / `with-owner-lock-guard` の排他そのものは対象外（既存の e2e ケースが一部を見ている）。
- **heartbeat のループ**。1 回分 `heartbeat-once!` だけが対象。1 秒ごとの繰り返しと、所有が変わったときに止まる処理は対象外。
- **計画停止の印の保存期限の設定値**。既定の 3600 秒だけを扱う（環境変数での変更と下限 600 秒は対象外）。
  期限ちょうど（3600 秒）の境界も、時計の刻みが 90・91・3601 秒なので通らない。
- **壊れたファイル**（lock・印・状態ファイルが読めない、欠けている）と、その片付け。
- **チケットが複数ある場合**と `tick --ticket` の絞り込み。
- **回収したときにチケットへ書く Notes・run summary**、lane の移動、agent の停止。
- **状態ファイルと process の世代がずれた状態**（owner id の再利用、one-shot の `tick` が loop の instance を名乗る場合）。
  不変条件（規則 7）がこの状態を届かないものとして除いている。
- 手順の長さは **最長 5 手**（4 手以内で届く状態から 1 操作）まで。5 手目で初めて届く状態からの操作と、それより長い並びでだけ出る違いは見つからない。

## 手順の生成（再現）

```sh
cd tests/codex-workspace/lock-model
lean LockModel.lean                                   # 定理の検査（通れば何も出ない。2CPU で約 55 秒）
lean --run LockModel.lean cover 5 | gzip -n -9 > lock-traces.txt.gz   # 手順の生成（約 40 秒、24,207 本。展開後 約 2.4MB、圧縮後 約 0.1MB）
bb ../task-board-lock-trace-test.bb                   # 再生（約 25 秒、Lean 不要）
```

`cover N` は、初期状態から N-1 手以内で届く全ての状態について、そこからの 15 操作を 1 回ずつ通る手順の集合を出す。手順は最長 N 手で、N 手目で初めて届く状態はそこへ届くところまで
（同じ状態へは最短の手順 1 本だけを伸ばす）。`full N` は N 手の全ての並び（15^N 本。比較用で、コミットしない）。
出力は決定的で、同じモデルからは同じファイルになる。CI（`Test Task Board Lock Model`）は Lean を入れて
定理の検査と「生成し直した結果がコミット済みファイルと同じか」を調べ、どちらかが成り立たなければ失敗する。

## merge の必須条件（BOXP-652）

main の必須 check は `status-check`（`.github/workflows/test.yaml`、`pull_request_target`）だけなので、Lean の検査はそこへつないである。

- `test.yaml` の job `lock-model` が `test-task-board-lock-model.yml` を呼び、`status-check` がその結果を待つ。
  検査が失敗すると `status-check` が失敗し、merge できない。Task Board runner の PR gate も失敗した check があると通さない。
- 動く条件（`wc-path-filter.yaml` の `lock-model`）: `tests/codex-workspace/lock-model/**`、`test-task-board-lock-model.yml`、
  `wc-path-filter.yaml`、`test.yaml` のどれかを PR が変えたとき。それ以外の PR では job は skip され、`status-check` に影響しない。
- 必須の検査は **base（main）側の workflow** で PR のモデルを調べる。PR の中で workflow を書き換えても、その PR の必須の検査は変わらない。
  このため Lean の版と sha256 は workflow ではなく、このディレクトリの `lean-toolchain` と `lean-linux.tar.zst.sha256` から読む
  （Lean を上げる PR は 2 つのファイルを一緒に変える）。
- `test-task-board-lock-model.yml` 自体を変える PR では、変更後の定義を merge 前に試すために同じ検査が `pull_request` でも 1 回動く（こちらは必須 check ではない）。
- runner の実装だけを変えた PR では Lean の検査は動かない（モデルも生成物も変わらないため）。実装とモデルの食い違いを見るのは手順の再生で、これは必須にしていない。
- job が時間切れで cancel 扱いになると `status-check`（`if: failure()`）は失敗にならない。これを避けるため各 step に上限を置き、時間切れは step の失敗として数える。
- Lean は証明を `sorry` に置き換えた定理も、`axiom` で足した主張も、終了コード 0 で通す（`sorry` は warning だけ）。このため検査は、
  コンパイルしたモデルを読み直し、モデル内の全ての宣言が Lean 標準の公理 3 つ（`propext`・`Classical.choice`・`Quot.sound`）以外に依存していないことも調べる。
  `sorry`（`sorryAx`）や足した公理、`native_decide` などがあれば失敗する。この検査は workflow の中に書いてあり、モデルのディレクトリには置いていない
  （PR が自分で弱められないようにするため）。手元の `lean LockModel.lean` だけではこの点は調べられないので、warning が出ていないことを見る。

Lean の入手: <https://github.com/leanprover/lean4/releases/tag/v4.36.0>（展開後 約 3GB）。
`elan` を使う場合は `lean-toolchain` が版を決める。Lean の版を変えるときは `lean-toolchain` と、
新しい `lean-<版>-linux.tar.zst` の sha256 を書いた `lean-linux.tar.zst.sha256` を同じ PR で変える。

## モデルや実装を変えるとき

1. 実装の挙動を変えるなら、先に上の規則のどれが変わるかを決め、`LockModel.lean` の `step` と該当の定理を直す。
2. `lean LockModel.lean` で定理が通ることを確かめ、`lock-traces.txt.gz` を生成し直す。
3. `bb ../task-board-lock-trace-test.bb` が不一致 0 になることを確かめる。不一致は「操作列・期待・実際」を最短のものから表示する。
4. 規則・対応・対象外が変わったら、この README の表を直す。

`lock-traces.txt.gz` を手で直さない。中身は `gzip -dc lock-traces.txt.gz` で読める。モデルを直さずに実装だけ変えた場合は再生テストが不一致を報告する（それが目的）。

## 隔離

再生テストは毎回新しい一時ディレクトリを root と vault にし、runner が環境変数を読む関数を差し替えるので、
シェルに設定された本物の root・vault には触れない。runner のテスト用フック（`CODEX_TASK_BOARD_TEST_*`）が
環境にあると実行を拒否する。欠陥を入れた比較（変異テスト）は `task-board-mutation.bb` の隔離コピー上だけで行う。
