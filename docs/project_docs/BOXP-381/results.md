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

ローカル（同一マシン、同条件）で `tests/codex-workspace/task-board-runner-test.sh` を前後で実測:

| 条件 | real |
|---|---|
| 変更前（HEAD の複製で実行） | 2m17.9s |
| 変更後（PBT 4 性質 + mutant sentinel + 回帰を追加） | 2m18.4s |

差分は約 0.5 秒（PBT スクリプト単体 0.28 秒）。GitHub Actions 上の実測は PR の
`Test Codex Task Board Runner` ジョブで確認する（下記 PR 参照、結果は本票 Notes に追記）。

## 現行 TDD の red → green 証拠について

- 既存テストは bash 黒箱テスト + runner 内蔵 `bb task_board_runner.bb test`（手書き PASS/FAIL）で、
  失敗時の出力は CI ログにしか残らない。本 pilot では red 実行の出力を本書に転記し、
  PBT の失敗出力に seed と再現コマンドを含めることで、ローカルでの再現を可能にした。
- `clojure.test.check.clojure-test/defspec` は Babashka に同梱されていないため、
  `tc/quick-check` + 固定 seed + `clojure.test/deftest` で代替した。JVM への移行は不要だった。
