# BOXP-616: Task Board runner のミューテーションテスト

前段: [BOXP-600](../BOXP-600/plan.md)（kohako-studio へ導入）/ [BOXP-613](../BOXP-613/plan.md)（同 検出力点検と整理）

## 何をどこまでやるか（担当判断）

- 対象は `docker/codex-workspace/task-board/` の **安全境界** に限る。runner は 9,000 行超・465 関数で、
  既存テストは e2e の shell ケース 179 件（1 件 3〜8 秒、全件 20 分前後）が主体のため、全関数 × 全ケースの
  変異は現実的でない。承認・排他・安全の判断に直結する関数を選んだ:
  - **runner-gates**（`task_board_runner.bb`, 22 関数）: agent の最終メッセージのマーカー
    （`TASK_BOARD_RESULT` / `WAIT_REASON` / `RECHECK_AT` / `REVIEW_PR`、PR URL）、codex review の P0/P1 判定、
    CI check と mergeStateStatus の判定、結果から次 lane を決める `intended-outcome` / `final-status`、
    自動継続上限、ticket lock の stale/同一性、PR gate 失敗予算。
  - **todos-gate**（`task_board_todos.bb`, 7 関数）: 未受領の改訂や使えない Conditions（Owner 返信の無い【承認】、
    コマンド外の書き換え）で done/blocked を保留する判定。
- 変異は **隔離コピー上だけ** で実行する。checkout・本番 runner・実 vault には一切書かない
  （出力先が checkout 内なら拒否、テスト実行時は `CODEX_TASK_BOARD_*` を環境から外し TMPDIR もコピー内）。
- スコアを必須ゲートにはしない。CI は report-only（BOXP-600 と同じ判断）。

## 方式: 薄い自前ランナー（bb + rewrite-clj）

clj-mutate 等の外部ツールは使わず、babashka 同梱の rewrite-clj で 380 行ほどのランナーを書いた
（`tests/codex-workspace/task-board-mutation.bb`）。理由: runner は deps を持たない bb スクリプトで、
テストも bb/shell。依存追加なしで CI と同じ bb だけで動き、対象関数の限定・e2e ケースの選択を
このリポジトリの事情に合わせられる。

- 演算子: 比較（`=`/`not=`、`<`/`<=` …）、`and`/`or`、`when`/`when-not`、`if`/`if-not`、`inc`/`dec`、
  `empty?`/`seq`、`some`/`every?`、`filter`/`remove`、`contains?`・`str/blank?` の否定、真偽値、整数 ±、
  `(not x)` → `x`、`cond` 節の削除、集合リテラルの要素削除（例: `#{"P0" "P1"}` から P1 を落とす）、
  正規表現の `^`/`$`/`\s*`/フラグ 1 文字の削除（マーカー行の誤読を狙う）。
- テストの選び方: グループ毎の直接テスト（bb）を必ず実行し、`:runner-cases` のグループは
  一度だけ計装付きで e2e 全 179 ケースを流して「どのケースがどの関数に到達するか」を記録（キャッシュ）、
  変異毎に到達するケースを速い順に足す。最初に落ちた時点で打ち切り（kill-first）。
- 生存変異は読んで分類し、等価なものだけ `task-board-mutation-targets.edn` の `:equivalent` に理由付きで登録する。

### 再実行方法

```sh
bb tests/codex-workspace/task-board-mutation.bb --self-test           # 演算子・適用・計装の自己テスト
bb tests/codex-workspace/task-board-mutation.bb --list --verbose       # 変異一覧
# 開発反復（直接テストのみ、runner-gates 230 変異でローカル 2CPU 約 1.5 分）
bb tests/codex-workspace/task-board-mutation.bb --group runner-gates --direct-only --jobs 2
# 既存 e2e ケースも使う計測（初回はカバレッジ計測 約 20 分/2 並列、以降キャッシュ）
bb tests/codex-workspace/task-board-mutation.bb --group runner-gates --jobs 2 --max-cases 10
bb tests/codex-workspace/task-board-mutation.bb --group todos-gate --jobs 2   # 約 9 分
# 1 関数だけ: --fn classify-codex-review
```

出力（`summary.md` と変異毎の結果 EDN）は既定で `$TMPDIR/task-board-mutation/`、`--out` で変更できる。

## 結果

実測はローカル 2CPU、`--jobs 2`。

### todos-gate（既存 `task-board-todos-test.bb` のみ）

| 変異 | 検出 | 生存 | スコア | 所要 |
|---|---|---|---|---|
| 72 | 72 | 0 | 100% | 9 分 2 秒 |

承認・Conditions の保留判定は既存テストが機能している。テストの追加・削除はしていない。

### runner-gates

| 段階 | 変異 | 検出（Timeout 含む） | 生存 | 未到達 | 等価 | スコア（等価除く） | 所要 |
|---|---|---|---|---|---|---|---|
| 変更前（既存テスト: same-file-review + 関数毎に速い順 10 e2e ケース） | 230 | 126 | 103 | 1 | (6) | 56.3% | 51 分 |
| 変更後（+ 新設 `task-board-runner-boundary-test.bb`） | 230 | 224 | 0 | 0 | 6 | 100% | 1 分 56 秒 |
| 変更後 `--direct-only`（CI の report と同じ） | 230 | 224 | 0 | 0 | 6 | 100% | 約 1.5 分 |

カバレッジ計測（e2e 179 ケースを計装付きで 1 回）: 2 並列で約 20 分、全ケース成功、129 ケースが対象関数に到達。

#### 変更前の値は下限（全ケースでの再計測）

`--max-cases 10` の変更前計測は、e2e を全部使えば殺せる変異も生存に数える。2 関数を全ケースで測り直した:

| 関数 | 到達 e2e ケース | 10 ケース上限 | 全ケース | 全ケースの所要 |
|---|---|---|---|---|
| `merge-state` | 53 | 3/12 | 5/12 | 25 分 52 秒 |
| `result-marker` | 124 | 2/6 | 3/6 | 27 分 51 秒 |

全ケースでも `result-marker` の `^` 削除・`$` 削除・`(?i)` 削除は生存し、`merge-state` の 7 件も生存した。
主要な見逃しは e2e を増やしても埋まらず、直接テストが必要だったことは変わらない。全 103 生存変異を全ケースで
測り直すのはローカルで数時間かかるため行っていない。

#### 変更前に生存していた意味ある見逃し（新設テストで検出するようにしたもの）

本番コードに実バグは無かった。どれも「その規則を壊しても既存テストが気付かない」状態だった。

- **マーカーを行頭・行末でしか読まない規則**（`result-marker` 4、`wait-reason-marker` 2、`no-repo-review-marker?` 3、
  `recheck-at-marker` 1、codex review の FINDING/RESULT 行）: `^` や `$` を落としても既存テストは通った。
  変異下では、prompt に書かれた説明文を agent が引用しただけの行（`End with TASK_BOARD_RESULT: done`）が
  その run の結果として読まれ、ticket が done になる。大文字小文字を問わない規則（`(?i)`）も未固定だった。
- **codex review の判定**（`classify-codex-review` 24、`codex-review-findings` 11）: 不正出力の理由の優先順位
  （空 → marker 無し → marker 重複 → severity 無し → 不明 severity → 形式不備 → 契約外の文）、P0/P1 だけが
  blocking で P2/P3/nit は pass-low、空行は契約外の文に数えないこと、文中に引用された FINDING 行は所見に数えないこと。
- **merge state**（10 ケース上限で 9、全 53 ケースでも 7）: UNKNOWN/BEHIND を pending にする分岐と集合要素、
  `HAS_HOOKS`/`BLOCKED`/`UNSTABLE` を pass 集合から落とす変異、状態欠落時の文言は全ケースでも検出されなかった。
  draft・DIRTY の分岐削除は 10 ケース上限では生存したが、全ケースなら e2e（`test_review_with_draft_pr_is_retried`、
  `test_review_with_conflict_is_blocked`）が検出する。
- **次 lane の決定**（`intended-outcome` 7、`final-status` 3）: agent プロセスが非 0 終了なら done を返しても
  blocked、groom/docs-groom の扱い、gate 不合格かつ再試行不可なら blocked、owner-acceptance は blocked。
- **自動継続上限**（`consume-continuation!` 4）: 上限ちょうどは許し超過で止める境界、超過時に
  `:retryable? false` と `:continuation-exhausted? true` を付けること。
- **lock**（`stale-lock?` 1、`same-ticket-lock?` 1）: stale 判定の境界（ちょうどは生存）、4 項目すべての一致。
- **PR gate 失敗予算**（`gate-budget-scope-prs` 9 = 全滅、`gate-budget-status` 12、`gate-failure-class` 5）:
  ticket が最初に登録した PR だけを範囲に入れ自分の除外を引くこと、PR 数に比例する上限、
  legacy grant は下限の引き上げ・additive grant は上乗せ、PR 単位は報告のみで枯渇させないこと、timeout は gate に
  関係なく result-unknown。
- `check-completed?` 4・`ci-state` 2: commit status の state による完了判定、check が 1 つも無いときは pending、
  未完了の check が残る間は passed にしないこと（この分岐を消すと pending の check が通過扱いになる）。

#### 等価として accept した 6 件（`task-board-mutation-targets.edn` の `:equivalent`）

- `classify-codex-review` の行判定の `^`/`$` 削除 2 件: `re-matches` は行全体に一致させるので無意味。
- `codex-review-findings` の `(.*)$` の `$` 削除: 入力は行分割済みで `.*` が行末まで取る。
- `codex-review-findings` の `(< (count parts) 3)` の 2 変異: 3 つに分かれなければ説明が空になり、
  どのみち malformed になる（冗長な条件）。
- `intended-outcome` の集合から `"continue"` を落とす変異: `:else` も `"continue"` を返す。

#### 既存テストの整理（削除・統合）

削除・統合はしていない。理由:
- todos-gate は全変異を既存テストが検出しており、役目を失ったテストの兆候が無い。
- runner の既存テストは e2e（lane 移動・ファイル書き込み・lock・プロセス管理の結合）で、今回の変異は判定関数に
  限っている。関数単位の変異を殺さないことは e2e ケースの価値の否定にならないため、これを根拠に消さない。
- 新設の直接テストは 1 秒未満で、e2e ケースと重複して削れる時間も無い。

## CI への配置

- `remaining` スイートに直接テスト `task-board-runner-boundary-test.bb` とランナーの `--self-test` を追加
  （どちらも 1 秒未満、`ci-partition-test.py` の一覧にも登録）。
- 別ジョブ `mutation`（report-only）で runner-gates を `--direct-only` 実行し、結果を job summary に出す。
  `test`（必須の集約結果）の `needs` には入れないので、生存変異で PR は落ちない。ツールが壊れたときだけ失敗する。
- todos-gate（直接テスト 1 本が約 15 秒 × 72 変異）と e2e ケース込みの計測は時間がかかるため手動実行に留める。

## 限界

- e2e ケース込みの計測は関数毎に速い順 10 ケースまで（`--max-cases 10`）。全ケースを使えば殺せる変異も
  「生存」に数えている可能性がある（変更前の数字は既存テストの検出力の下限）。
- カバレッジは関数単位で、計装は複数 arity の最初の arity にだけ入る。
- 演算子は判断の分岐に絞っており、文字列（メッセージ文言）の変異はしない。
