# BOXP-381: PBT pilot 実行結果

計画と性質の定義は [plan.md](plan.md) を参照。本書は実行結果・反例・再現コマンド・実時間の記録。

## 実行方法

```bash
# 既存 CI 入口（既存テストの後に PBT を 1 関数として追加）
tests/codex-workspace/task-board-runner-test.sh

# PBT 単独実行（既定: seed=20261102, num-tests=200, max-size=50）
bb tests/codex-workspace/task_board_pbt_test.bb

# seed / 回数 / サイズの変更
TASK_BOARD_PBT_SEED=7 TASK_BOARD_PBT_NUM_TESTS=1000 bb tests/codex-workspace/task_board_pbt_test.bb
```

失敗時はスクリプトが shrink 済み最小反例・元の失敗入力・再現コマンド
（`TASK_BOARD_PBT_SEED=<seed> bb tests/codex-workspace/task_board_pbt_test.bb`）を標準出力に出す。

## 結果一覧（修正後、ローカル bb 1.13.229 / CI 相当 bb 1.12.218 で同一結果）

| 性質 | seed | num-tests | max-size | 実時間 | 結果 |
|---|---|---|---|---|---|
| P1 card-render-parse-roundtrip | 20261102 / 7 / 99 | 200 / 200 / 1000 | 50 | 9〜56 ms | pass |
| P2 normalize-card-line-idempotent-and-preserving | 20261102 / 7 / 99 | 200 / 200 / 1000 | 50 | 20〜85 ms | pass |
| P3 runner-and-helper-board-parsers-agree | 20261102 / 7 / 99 | 200 / 200 / 1000 | 50 | 143〜679 ms | pass |
| P3' board-parsers-agree-with-foreign-headings | 20261102 / 7 / 99 | 200 | 50 | 約 175 ms | **修正前 fail → 修正後 pass** |
| mutant sentinel（P1 に対する隔離 mutant） | 20261102 固定 | 200 | 50 | 約 10 ms | 期待どおり fail を検出 |

PBT スクリプト全体の実時間: 約 0.28 秒（`time bb tests/codex-workspace/task_board_pbt_test.bb`, real 0.275s）。

## 実バグ発見（P3' / 人工 mutant ではない）

- 発見経路: P3 の拡張探索として「レーン外見出し（`## Notes`, `## Archive`）とその下のカード」を
  生成範囲に加えたところ、runner `parse-board-cards` と helper `board-cards` が食い違った。
- 初回失敗入力は 6 レーン・23 枚のカードを含む Board（長い）。test.check の shrink により
  次の最小反例に縮小された（seed 20261102、seed 7 でも同型の最小反例）。

```clojure
["---" "kanban-plugin: board" "---" ""
 "## Backlog" "## Ready" "## In Progress" "## Blocked" "## Review" "## Done"
 "## Notes"
 "- [x] [[Tickets/BOXP-1|BOXP-1: !]] #ticket status::done priority::low done::2026-11-02"]
```

- 原因: helper の `board-cards` はレーン以外の見出しを読んでも直前のレーンを保持し続けるため、
  `## Notes` 配下のカードを `Done` レーンのカードとして返していた。runner は `## Notes` で
  レーン区間を終端するため無視する。「レーン位置が状態の SSOT」という Board 運用ルールに照らすと
  helper 側が誤り。
- 修正（最小）: `board-cards` でレーン外見出しに到達したら lane を `nil` にリセット
  （`docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`）。
- red → green の証拠:
  - 修正前: `PBT board-parsers-agree-with-foreign-headings pass?=false num-tests=1` と
    `regression-card-under-foreign-heading-belongs-to-no-lane` の 2 assertion が失敗
    （`Ran 3 tests containing 9 assertions. 3 failures`、exit 1）。
  - 修正後: 全性質 pass（`Ran 3 tests containing 9 assertions. 0 failures`、exit 0）。
- 回帰: 上記最小反例を固定入力とする `clojure.test` の `deftest`
  `regression-card-under-foreign-heading-belongs-to-no-lane` を追加。
- 影響範囲: 実 Board（`Boards/Task Board.md`）はレーン見出しの後にレーン外見出しを持たないため、
  現時点の運用に影響はない。将来 Board に `## Notes` 等を追記した場合に helper の
  `list` / `show` / `update` が誤ったレーンを返す潜在不具合の解消。

## レビュー指摘から追加した性質 P4（remove-card はレーン内カードのみ削除）

PR #14332 の codex-review が P1 として指摘: `board-cards` がレーン外見出し配下のカードを無視するようになった結果、
同じチケットがレーン内と `## Notes` 配下の両方にある場合、`card-for` は重複と判定しなくなる一方、
`cmd-update` → `insert-card` → `remove-card` は Board 全体から該当チケット ID を含む行を削除していたため、
通常の更新で Notes 内のコピーが黙って消える（修正前は `Multiple board cards found` で停止していた）。

- 利用者意図: レーン位置が状態の SSOT であり、レーン外見出し配下の行は helper の更新対象ではない。
  更新・削除はレーン内のカード行だけを動かし、それ以外の行は一字一句保持する。
- 性質 P4 `remove-card-only-touches-lane-cards`: `(board-gen true)`（`## Notes` / `## Archive` 配下のカードを含む
  生成 Board）と Board 内に存在する任意の ID について、`task-board/remove-card` の結果が
  「runner `parse-board-cards` が返すその ID のカードの `:idx` だけを取り除いた行列」と一致する。
  oracle は runner 側（独立実装）で、helper 自身は使わない。
- 修正（最小）: `remove-card` を `board-cards` と同じ見出し規則でレーンを追跡し、
  「レーン区間内 かつ `card-line?` かつ 該当 ID を含む行」のみ除去するよう変更。

red → green の証拠（seed 20261102, num-tests 200, max-size 50）:

```text
# 修正前（remove-card を旧実装に戻して実行）
PBT remove-card-only-touches-lane-cards pass?=false num-tests=4 seed=20261102 max-size=50 elapsed-ms=379
  shrunk smallest: [[["---" "kanban-plugin: board" "---" ""
                      "## Backlog" "- [ ] [[Tickets/BOXP-1|BOXP-1: !]] #ticket status::backlog priority::low"
                      "## Ready" "## In Progress" "- [ ] [[Tickets/BOXP-2|...]]" "- [ ] [[Tickets/BOXP-3|...]]"
                      "## Blocked" "- [ ] [[Tickets/BOXP-4|...]]" "- [ ] [[Tickets/BOXP-5|...]]"
                      "## Review" "## Notes" "- [ ] [[Tickets/BOXP-6|BOXP-6: !]] #ticket status::review priority::low"
                      "## Done" "- [x] [[Tickets/BOXP-7|BOXP-7: !]] #ticket status::done priority::low done::2026-11-02"] "BOXP-6"]]
FAIL in (regression-update-keeps-card-copy-under-foreign-heading) ×2
3 failures, 0 errors.

# 修正後
PBT remove-card-only-touches-lane-cards pass?=true num-tests=200 seed=20261102 max-size=50 elapsed-ms=162
Ran 4 tests containing 15 assertions. 0 failures, 0 errors.   (real 0.64s)
# seed 7 / num-tests 1000 でも pass（elapsed 1459 ms）
```

- 回帰: 決定的 `deftest regression-update-keeps-card-copy-under-foreign-heading`（Ready と `## Notes` に同じカード、
  `insert-card` で In Progress へ移動後も Notes 区間が原文のまま、Ready から消え、In Progress に 1 枚）と、
  bash 黒箱 `test_helper_update_keeps_notes_copy`（`task-board.bb update --lane Ready` 実行後に Notes のコピーと
  メモ行が残り、In Progress から Ready へ移る）を追加。
- 付随する挙動変更: 旧 `remove-card` はレーン内の「カードではない行」（例: チケット ID を含むメモ）も削除していたが、
  新実装はカード行のみ削除する。`cmd-delete` も同じ関数を使うため、レーン外のコピーは delete でも残る
  （Notes 等はユーザー管理の本文として扱う）。
- この指摘は Fable 側の `board-cards` 修正が生んだ派生不具合で、P3' だけでは検出できなかった
  （P3' は読み取り一致のみを見る）。書き込み系の純粋関数にも oracle 付き性質を置く必要があることが分かった。

## 人工 mutant による検出能力確認（実バグとは区別）

- mutant: `task-board/encode-card-title` を `identity` に差し替え（タイトルの `]` と `\` を
  エスケープしない）。`with-redefs` によりテスト内で隔離、本番コードは無変更。
- 結果: P1 が失敗し、shrink によりタイトル `"]"` 1 文字の最小反例に縮小された。

```clojure
[{:id "BOXP-1", :title "]", :lane "Backlog", :priority "low", :assignee nil, :repo []}]
```

- `mutant-unescaped-title-is-detected` として seed 固定で常時実行し、検出能力が退化していないことを確認する。

## 探索で見つかったが修正しなかった仕様差（Owner 判断を求める）

見出し末尾に空白がある場合（例: `"## Done "`）の扱いが runner と helper で異なる
（生成範囲には含めず、手動プローブで確認）。

- runner `section-index` は `"## Done"` と完全一致を要求するため、末尾空白付き見出しは
  「レーンが存在しない」扱いになり `move-card!` が `missing lane` で失敗する。
- helper は `^##\s+(.+?)\s*$` で末尾空白を無視するため、レーンとして認識する。
- 選択肢:
  1. runner 側を `str/trimr` 比較にして helper に合わせる（寛容化、1 行の変更）
  2. 現状維持（Obsidian Kanban plugin は末尾空白を書かないため実害なし）
- 本票では **2（現状維持）** を採り、本書に記録のみ行う。1 を選ぶ場合は別票で runner の
  `section-index` を変更し、本 PBT の生成範囲に末尾空白を追加すれば自動で検証される。

## 何を検査でき、何を保証しないか

- 検査できること
  - helper `remove-card` が、runner `parse-board-cards` の返すレーン内カードだけを取り除き、
    レーン外（frontmatter, `## Notes` 等）の行を保持すること（P4）。
  - helper のカード render → parse が id / title / lane / priority / assignee / repo / done を
    保存すること（タイトルに `]`, `\`, `|`, `#`, `::`, 日本語を含む場合を含む）。
  - runner `normalize-card-line` が冪等で、`status::` / `done::` 以外のトークンを保存すること。
  - runner と helper の Board パーサが、6 レーン + レーン外見出しを含む生成 Board で
    同じ `{ticket-id, lane}` 集合を返すこと。
- 保証しないこと
  - 空白の連続や前後空白の保持（`remove-attr` が空白を正規化するため、トークン単位の比較に留める）。
  - 実ファイル書き込み（`move-card!`, `sync-board-statuses!`, `insert-card`）や lock の並行正当性。
    これらは既存の bash 黒箱テスト・並行テストが引き続き担当し、PBT では扱わない。
  - 見出し末尾空白、frontmatter の変種、`## ` 以外の見出しレベル（生成範囲外）。
  - instrument / spec だけでは戻り値や上記性質は検証されない。本 pilot では spec は
    `::card` の shape 定義と生成器（`s/gen`）にのみ使い、性質は test.check の明示 property で検証した。

## CI 時間への影響

ローカル（同一マシン、同条件、逐次実行）で `tests/codex-workspace/task-board-runner-test.sh` を前後で実測:

| 条件 | real |
|---|---|
| 作業開始時の base（古い main）で実行 | 2m17.9s |
| 同 base + PBT 追加 | 2m18.4s |
| 現 `origin/main`（1b27cdf3d）の複製で実行 | 10m51.1s |
| 現 main をマージした本ブランチ（PBT 追加後） | 10m52.4s |

差分はいずれも約 0.5〜1.3 秒（PBT スクリプト単体 0.28 秒）。

GitHub Actions `Test Codex Task Board Runner` の実測:

| 対象 | job 時間 |
|---|---|
| main 直近 3 run（41369997097 / 41369483395 / 41284319288） | 16m40s / 17m20s / 16m49s |
| 本 PR run 41394790490（PBT 込み） | 16m44s |

CI ログ上の PBT 行（bb 1.12.218）: P1 16 ms / P2 34 ms / P3 260 ms / P3' 311 ms、
`Ran 3 tests containing 9 assertions. 0 failures, 0 errors.`

## 現行 TDD の red → green 証拠について

- 既存テストは bash 黒箱テスト + runner 内蔵 `bb task_board_runner.bb test`（手書き PASS/FAIL）で、
  失敗時の出力は CI ログにしか残らない。本 pilot では red 実行の出力を本書に転記し、
  PBT の失敗出力に seed と再現コマンドを含めることで、ローカルでの再現を可能にした。
- `clojure.test.check.clojure-test/defspec` は Babashka に同梱されていないため、
  `tc/quick-check` + 固定 seed + `clojure.test/deftest` で代替した。JVM への移行は不要だった。
