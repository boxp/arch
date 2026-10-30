# BOXP-369: 同一ticket・PRのゲート累積失敗10回で自動再試行を止める

## 背景

BOXP-360 で、`task_board_runner.bb` の短期 retry 上限（`CODEX_TASK_BOARD_PR_GATE_RETRY_LIMIT`、既定 2）が
`retry-fingerprint = PR URL | gate | sha256(失敗本文)` 単位で数えられるため、codex review の本文や
CI check 名が変わるたびに count が 1 に戻り、58 回連続で自動再試行された（全件 count 1）。

## 正本となる定義

| 項目 | 定義 |
| --- | --- |
| 記録先 | `$CODEX_TASK_BOARD_ROOT/gate-failure-budget.edn`（state.edn とは別ファイル。`locks/gate-failure-budget.lock` の FileLock + JVM 内 `locking` 下で read-modify-write、tmp+atomic rename で書き込み） |
| 数える対象 | runner の PR gate が **retryable** と判定した失敗（= 自動再試行を生む失敗）1 run につき 1 件。キーは `ticket/run-id` なので同じ run の再処理では二重計上しない |
| 数えない対象 | agent プロセス異常終了・idle timeout・planned shutdown などのインフラ中断（gate に到達しない）、non-retryable gate 失敗（すでに即 Blocked） |
| 分類と根拠 | `class` = `ci-failure` / `review-findings` / `merge-state` / `result-unknown`（timeout 等）。根拠として `class-basis = gate=…; failure-kind=…` と派生 diagnostic category のみを記録。本文・stderr は記録しない |
| 単位 | (1) ticket 単位 (2) 正規 PR 単位 `owner/repo#N`（小文字化）。どちらかが上限に達したら停止 |
| 初期上限 | 10。`CODEX_TASK_BOARD_GATE_FAILURE_BUDGET` は **下げる方向のみ** 有効（10 超は 10 に丸め、最小 1） |
| 停止 | used が limit に達した失敗（10 回目）で、短期上限が残っていても `in-progress` に戻さず Blocked + assignee boxp へ遷移。category=`gate-failure-budget-exhausted` |
| 11 回目の防止 | 予算超過 ticket（ticket 自身、失敗歴のある PR、または ticket 本文/Notes が参照する PR のいずれか）は、カードや担当を戻しても `implement` / `review-fix` / `blocked-retry` の自動 run を開始しない（ログのみ）。PR URL は大文字小文字・scheme 有無を問わず抽出し正規化する |
| 開始の直列化 | ticket lock 取得直後・lane/Notes 遷移前に、予算 lock 下で上限を再確認し `:reservations` に予約（ticket・run-id・対象 PR）を書く。別 ticket の生きた予約が同じ PR を持つ間はその run を開始しない（lock を戻すだけで状態変更なし）。予約の生存は「その ticket の lock が同じ run-id で stale でない」ことで判定し（heartbeat の書換と競合しないよう ticket lock guard 下で読み、存在する空 lock は生存扱い）、終了・クラッシュ・回収時の明示解放は不要 |
| reset 条件 | **なし**。成功（gate pass）、本文/head 変更、新 run、runner 再起動、担当交代、新 PR 作成のいずれでも減らない。成功時の短期 retry state（`clear-pr-gate-retries!`）は従来どおり消える |
| 明示再開 | Owner が `bb task_board_runner.bb gate-budget-grant <BOXP-N|owner/repo#N> --amount N --by <Owner>` で追加予算を **追記** し、担当を戻す。記録の削除では帳尻を合わせない。状況確認は `gate-budget-status BOXP-N` |

### 複数 PR の扱い

- ticket 単位予算はその ticket が報告したすべての PR の失敗を合算する。別 PR を作り直しても ticket 予算は戻らない。
- PR 単位予算は同じ PR を扱うすべての ticket の失敗を合算する。別 ticket へ付け替えても PR 予算は戻らない。新 ticket でも本文/Notes に上限到達 PR の URL があれば run 開始前に止める。PR を参照しない新 ticket が上限到達 PR へ push した場合は、その 1 run の gate 失敗時点で即停止する（追加 run は生まない）。
- 再開には停止原因となった単位（ticket / PR）の両方で予算が残っている必要がある。

### 既存保護との関係

- 短期上限（fingerprint 単位、既定 2）はそのまま。どちらか厳しい方が先に Blocked にする。
- lock / heartbeat / planned shutdown / unknown 保護、non-retryable gate の即 Blocked は変更しない。
- 既存 ticket には失敗記録がない状態から数え始めるため、進行中の 360/367 等を強制停止しない。

## 停止時の日本語報告（Blocked Notes）

`reason=` に以下を記載する（数値・gate 名・分類・派生 category・artifact パスのみ。本文や秘密は含めない）。

- 上限: `ticket BOXP-N used/limit, PR owner/repo#N used/limit`
- 直近: gate / 分類 / 分類根拠 / 未解決 category / 根拠 diagnostic パス
- 実施済み: 自動修正 run 回数と分類別内訳
- 必要判断: 方針決定と、上限到達した各スコープ（ticket / PR）それぞれへの `gate-budget-grant` コマンドによる明示再開

## 検証（fixture: tests/codex-workspace/task-board-runner-test.sh）

- `test_gate_failure_budget_boundary_9_10_11`: 本文毎回変化・担当交代・各 tick が別プロセス（再起動）で 9 回目は継続、10 回目で Blocked、カード/担当を戻しても 11 回目の run が生まれない、新 PR でも迂回不可、env で上限を緩められない、秘密が Notes / 記録に残らない
- `test_gate_failure_budget_multiple_prs_and_shared_pr`: 複数 PR の ticket 合算、同一 PR の ticket 横断合算、上限到達スコープごとの grant 案内、上限到達 PR を参照する新 ticket は run を開始しない（未到達 PR 参照は通常実行）、大文字ホスト/scheme なし URL でも迂回不可
- `test_gate_failure_budget_grant_resume_and_no_reset_on_success`: 不正 grant 拒否、ticket grant のみでは PR 予算で止まる、両方 grant で 1 run 再開、成功で減らない、付与分消費後に再停止
- `test_gate_failure_budget_stricter_short_term_limit_still_applies`: より厳しい既存短期上限が先に効く
- `test_gate_failure_budget_concurrent_start_on_shared_pr_is_serialized`: 残り 1 回の PR を参照する 2 ticket を別プロセスで同時起動しても run は 1 つだけ、PR は 2/2 で止まり、以後どちらも開始しない
- `test_gate_failure_budget_concurrent_updates_do_not_lose_counts` / `..._concurrent_ticks_...`: 並行 grant・並行 gate 失敗で記録が欠落しない
