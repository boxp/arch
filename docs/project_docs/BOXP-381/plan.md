# BOXP-381: Task Board の TDD へ spec / test.check による PBT を小規模導入する

## 目的

Task Board runner / Obsidian task-board helper の純粋関数に対して、
clojure.spec.alpha と clojure.test.check を使った小規模な Property-Based Testing (PBT) を
既存の TDD フロー（`tests/codex-workspace/task-board-runner-test.sh` → CI
`test-codex-task-board-runner.yml`）へ統合し、反例探索（失敗 → seed 再現 → shrink → 修正）を実証する。

別の PBT 基盤や全機能の mandatory 化、新しい承認 / retry ゲートは作らない。

## 調査結果（前提確認）

- 現行 TDD の実体: `tests/codex-workspace/task-board-runner-test.sh`（bash 黒箱テスト）と
  runner 内蔵の `bb task_board_runner.bb test`（PASS/FAIL を手書き println する形式、clojure.test 不使用）。
  red → green の証拠は PR の CI ログ以外に残らない。
- runtime 互換: CI は Babashka 1.12.218、Docker image は 1.13.219、ローカルは 1.13.229。
  いずれも `clojure.test.check` / `clojure.test.check.generators` / `clojure.test.check.properties` /
  `clojure.spec.alpha` / `clojure.spec.test.alpha` / `clojure.spec.gen.alpha` / `clojure.test` が
  組込みで利用可能（追加依存なし、JVM 不要）。
  `clojure.test.check.clojure-test`（`defspec`）のみ未同梱のため、`tc/quick-check` に固定 seed を
  与え `clojure.test` の `deftest` で包む。
- 両スクリプトはロード時にトップレベルで main を呼ぶため、テストから `load-file` するには
  `(= *file* (System/getProperty "babashka.file"))` の標準ガードが必要（最小変更）。

## 対象性質（Owner 意図に由来し、実装から独立した契約）

生成試験の対象は temp fixture / 純粋関数のみ。本番 vault、lock、外部 effect は触らない。

### P1. カードの render → parse 意味的 roundtrip（helper）

- 対象: `task-board.bb` の `card-line`（render）と `parse-card`（parse）。
- 利用者意図: `Boards/Task Board.md` のカード 1 行は、チケット id / タイトル / レーン / priority /
  assignee / repo / done の情報を失わずに保持する。特にタイトルに `]`, `\`, `|`, 全角文字,
  `#`, `::` を含んでも壊れない（vault 運用ルール上タイトルは自由文）。
- 性質: 任意の card データ `c` について
  `(parse-card (:lane c) (card-line c))` は `:id :title :lane :priority :assignee :repo` を
  そのまま復元し、`:done` は `(= "Done" lane)` に一致する。
- 生成範囲: id = `BOXP-<1..99999>`、title = 1〜40 文字の改行を含まない非空文字列
  （印字可能 ASCII + 日本語文字を混在、前後空白なし）、lane = 6 レーンのいずれか、
  priority ∈ {low, medium, high}、assignee = nil または `[a-z0-9-]+`、
  repo = 0〜3 個の `owner/name`。
- spec: `::card` を `s/keys` で定義し、生成には `s/gen` を使う（型/shape は spec で、
  roundtrip 自体は test.check の明示 property で確認する）。

### P2. `normalize-card-line` の冪等性と他属性保全（runner）

- 対象: `task_board_runner.bb` の `normalize-card-line`（`move-card!` / `sync-board-statuses!` で使用）。
- 利用者意図: レーン移動でカードの `status::` と `done::` だけが更新され、
  `priority::` / `assignee::` / `repo::` / 未知の `key::value` やタイトルは変更されない。
  2 回適用しても結果は変わらない。
- 性質: 任意の card 行 `l`（P1 の render + 追加の未知属性 + 任意の既存 status/done）と
  任意の status `s` について
  1. 冪等: `(normalize (normalize l s) s) = (normalize l s)`
  2. status/done 以外のトークン（空白区切り）の多重集合は保存される
  3. 結果の `status::` は `s`、`done::` は `s = done` のときだけ存在する
  4. チェックボックスは `s = done` のときだけ `[x]`
- 保証しないこと: 空白の連続・前後空白の保持（`remove-attr` は空白を正規化する）。

### P3. 2 つの独立した Board パーサの一致（runner vs helper）

- 対象: runner `parse-board-cards`（lines → cards）と helper `board-cards`（board string → cards）。
  別々に書かれた実装同士を互いの reference model として使う（実装自身を oracle にしない）。
- 利用者意図: どちらのツールが Board を読んでも、同じカードが同じレーンに属する。
- 性質: 任意の生成 Board（6 レーン見出しを固定順で並べ、各レーンに 0〜4 枚の P1 カードを配置、
  レーン間に 0〜2 行の空行）について、`{ticket-id lane}` の集合が両者で一致する。
- 拡張探索（結果を記録する）: 見出しの末尾空白、レーン外見出し（`## Notes` 等）を混ぜた
  場合に両者が食い違うかを探索し、実バグか仕様差かを判定して報告する。

## 反例探索の実証計画

1. 各性質を `tc/quick-check` で `:seed` 固定、`num-tests` 200 程度で実行し、
   seed / num-tests / max-size / 実時間 / 失敗時の再現コマンドを `docs/project_docs/BOXP-381/results.md` に記録。
2. 実バグが見つからない性質は、隔離 mutant（`with-redefs` で `encode-card-title` の `]` エスケープを外す等）に
   対して失敗 → shrink された最小反例 → 元実装で pass を実証し、「人工的な検出能力確認」として区別して記録する。
3. 見つけた反例は `clojure.test` の決定的回帰（固定入力）として残す。
4. 既存テストは削除・弱化・選別しない。`task-board-runner-test.sh` の末尾に新テスト呼び出しを追加し、
   追加 CI 時間を前後で実測する。

## 変更予定ファイル

- `docker/codex-workspace/task-board/task_board_runner.bb`: 末尾 dispatch に `babashka.file` ガード（最小）。
- `docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb`: `(apply -main ...)` に同ガード。
- `tests/codex-workspace/task_board_pbt_test.bb`: spec + test.check + clojure.test の PBT。
- `tests/codex-workspace/task-board-runner-test.sh`: 新テストを 1 関数として呼び出す。
- `docs/project_docs/BOXP-381/plan.md`, `results.md`: 本計画と実測結果。

## Validation

- `tests/codex-workspace/task-board-runner-test.sh`（既存全件 + PBT）
- `bb tests/codex-workspace/task_board_pbt_test.bb`（単独実行・seed 再現）
- `git diff --check`, `actionlint`（workflow を触った場合のみ）
