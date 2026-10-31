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
| 停止遷移の完遂 | 上限到達の記録と Blocked 遷移の間で runner が落ちた場合（または上限到達後にカード/担当が戻された場合）、次の tick は run を開始せず、ticket lock 下で予算を再確認したうえで日本語の停止報告（`run=none; transition-id=BOXP-N/gate-budget-stop-<id>`）を Notes に追記し Blocked + assignee boxp へ遷移する（`stop-exhausted-ticket!`）。Blocked + boxp には自動 action がないため 1 回で止まり、Notes を繰り返し書かない。すでに Blocked のカードで担当だけが agent に戻された場合（candidate `:blocked-retry`）も同じ経路で停止報告を書き担当を boxp へ戻す（黙って拒否しない）。lock 取得後にカードを再読込し、並行 tick が先に停止を完了していれば（Blocked + boxp で候補 action なし）2 回目の報告や古い状態での復元をしない |
| reset 条件 | **なし**。成功（gate pass）、本文/head 変更、新 run、runner 再起動、担当交代、新 PR 作成のいずれでも減らない。成功時の短期 retry state（`clear-pr-gate-retries!`）は従来どおり消える |
| 明示再開 | Owner が `bb task_board_runner.bb gate-budget-grant <BOXP-N|owner/repo#N> --amount N --by <Owner>` で追加予算を **追記** し、担当を戻す。記録の削除では帳尻を合わせない。状況確認は `gate-budget-status BOXP-N` |

### 複数 PR の扱い

- ticket 単位予算はその ticket が報告したすべての PR の失敗を合算する。別 PR を作り直しても ticket 予算は戻らない。
- PR 単位予算は同じ PR を扱うすべての ticket の失敗を合算する。別 ticket へ付け替えても PR 予算は戻らない。新 ticket でも本文/Notes に上限到達 PR の URL があれば run 開始前に止める。PR を参照しない新 ticket が上限到達 PR へ push した場合は、その 1 run の gate 失敗時点で即停止する（追加 run は生まない）。
- 再開には停止原因となった単位（ticket / PR）の両方で予算が残っている必要がある。
- run 外の正式停止（`stop-exhausted-ticket!`）は予算の再読込・上限判定・Blocked 遷移を予算 lock 下で行い、Owner の `gate-budget-grant` と直列化する。grant は再読込の前（停止しない）か遷移の後（Blocked + grant 記録済み、Owner のレーン移動で再開）のどちらかにしか着地せず、残予算があるのに「上限到達」として停止することはない。lock 順序は予算 lock → ticket mutex / vault writer のみで、逆順に取る経路はない。

### 既存保護との関係

- 短期上限（fingerprint 単位、既定 2）はそのまま。どちらか厳しい方が先に Blocked にする。
- lock / heartbeat / planned shutdown / unknown 保護、non-retryable gate の即 Blocked は変更しない。
- 既存 ticket には失敗記録がない状態から数え始めるため、進行中の 360/367 等を強制停止しない。

### 設計判断（独立レビュー指摘への回答）

- **`result-unknown`（CI 待ち timeout / merge state 不明）も予算に数える**: これらも runner が retryable と判定して自動 run を生む失敗であり、360 の無限反復は本文の種類を問わず「自動 run が生まれ続けること」が問題だった。数えないと pending CI だけで無制限に run を消費できる。分類と根拠を記録するので、停止報告で `分類=result-unknown` と分かり Owner はインフラ要因と判断して grant できる（安全側の上限）。
- **PR URL を参照しない新 ticket が上限到達 PR へ push する場合**: run 開始前には PR の紐付けを知り得ないため、その 1 run の gate 失敗時点で即 Blocked となり追加 run は生まない（上記「複数 PR の扱い」）。新 ticket の作成は人の操作であり、自動反復にはならない。
- **`gate-budget-grant --by` の認証**: 本 CLI は Task Board root（PVC）へ書ける主体だけが実行でき、その主体は予算ファイルや vault 自体も編集できるため、ファイルシステム権限と同じ信頼境界に置く。本票は新規の秘密・権限を追加しない前提であり、付与者は監査用の自己申告として `grants` に残す。

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
- `test_gate_failure_budget_stop_reports_when_blocked_card_is_reassigned`: 上限到達で Blocked + boxp になった ticket の担当だけを agent に戻した場合、run を開始せず Blocked のまま日本語停止報告（action=blocked-retry）を 1 回だけ書き担当を boxp へ戻す
- `test_gate_failure_budget_stop_is_written_once_under_concurrent_ticks`: 担当だけ戻された Blocked カードを 2 つの tick が同時に処理しても（test hook で pre-check と lock の間を広げる）、停止報告は 1 回だけで担当は boxp に戻る
- `test_gate_failure_budget_stop_is_serialized_with_grant`: 停止処理が予算を再読込して Blocked 遷移する直前（test hook で予算 lock 保持中に release file を待つ）に Owner が grant を発行しても、grant プロセスが lock 待ちに入った後も予算ファイルに grant は記録されず、release 後に遷移完了してから grant が着地する（grant 復帰時点でカードは Blocked + boxp、停止報告 1 回、grant 記録あり）。再読込前に両スコープへ grant された場合は停止せず 1 run だけ再開する。時間待ちではなく release file と /proc の状態で同期するため起動時間に依存しない。予算 lock を外した runner ではこの fixture が「保持中に grant が記録された」で失敗することを確認済み
- `test_gate_failure_budget_stop_completes_after_interrupted_transition`: 上限到達の記録後に Blocked 遷移が失敗して In Progress に戻った ticket を、次の tick が run を開始せず Blocked + 日本語報告へ停止し、以降の tick で Notes を繰り返さず、両スコープの grant 後のみ 1 run 再開
- `test_gate_failure_budget_stricter_short_term_limit_still_applies`: より厳しい既存短期上限が先に効く
- `test_gate_failure_budget_concurrent_start_on_shared_pr_is_serialized`: 残り 1 回の PR を参照する 2 ticket を別プロセスで同時起動しても run は 1 つだけ、PR は 2/2 で止まり、以後どちらも開始しない
- `test_gate_failure_budget_concurrent_updates_do_not_lose_counts` / `..._concurrent_ticks_...`: 並行 grant・並行 gate 失敗で記録が欠落しない
