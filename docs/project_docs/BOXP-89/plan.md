# BOXP-89: task board runnerが新しく追加されたタスクに即対応するようにしたい

## 問題

現行の `tick!` 関数は、全候補チケットを `future` で起動した後、
`(doall (map deref runs))` で全 future の完了を待つ。
`loop!` は `tick!` が戻ってから `sleep` するため、
実行中のチケットが長時間かかると、その間に追加された新規チケットを次のポーリングまで検出できない。

## 解決方針

`in-flight-futures` atom（`ticket-id -> future` のマップ）を導入し、
実行中 future をまたいで管理する。

各 `tick!` 呼び出しで：
1. 完了済み future を回収して `in-flight-futures` から除去する
2. Task Board を走査して新規候補を取得する
3. すでに `in-flight-futures` にあるチケットは除外し、新規候補のみ future を起動する
4. 起動した future を `in-flight-futures` に登録する

`loop!` は `tick!` の完了を待つだけで、future の完了は待たない。
これにより `CODEX_TASK_BOARD_POLL_SECONDS` ごとに新規チケットを検出できる。

## 変更ファイル

- `docker/codex-workspace/task-board/task_board_runner.bb`
  - `in-flight-futures` atom を追加
  - `collect-completed-futures!` 関数を追加
  - `tick!` を非ブロッキング版に書き換え
  - `loop!` を簡略化（tick! の完了のみ待つ）
  - `run-tests!` に新テスト2件を追加
    - 実行中 future があっても新規候補を起動できることの検証
    - 実行中チケットが重複起動されないことの検証

## 維持する仕様

- Task Board lane を source of truth とするチケット単位ロック
- heartbeat、同期、実行結果による lane/frontmatter 更新
- assignee/lane による候補判定
- stale lock 回復
