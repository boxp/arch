# BOXP-377: レビュー差戻しを P1 以上に限定し P2 以下で自動修正を反復させない

## 背景

Owner 方針「P1 の指摘以外は相手にしなくていい」を Task Board runner の codex review gate に反映する。
現状の `docker/codex-workspace/task-board/task_board_runner.bb` の `run-codex-review!` は
`CODEX_REVIEW_RESULT: clean` / `issues` の 2 値しか持たず、`issues` は内容の重大度に関係なく
retryable な gate 失敗となり、短期 retry（fingerprint 単位、既定 2）と累積 gate-failure budget
（BOXP-369、上限 10）を消費して自動修正 run を生んでいた。

本票は severity 方針の変更だけを独立 scope として実装する。BOXP-360 / #14295 の累積上限 reset、
追加 grant、BOXP-376 の分析 PR 枠付与は扱わない（付与済みとも扱わない）。

## 正本となる定義

| 項目 | 定義 |
| --- | --- |
| review 契約 | review prompt は所見ごとに 1 行 `CODEX_REVIEW_FINDING: <P0\|P1\|P2\|P3\|nit> \| <file:line または領域> \| <一行説明>` を要求する。所見が 1 件でもあれば `CODEX_REVIEW_RESULT: issues`、所見ゼロのときだけ `CODEX_REVIEW_RESULT: clean` |
| P0 | 機密/認証情報の漏洩、データ消失、破壊的・不可逆操作、セキュリティ欠陥。安全上の blocking（常に差戻し） |
| P1 | この diff に含まれる具体的な欠陥で、実害と再現根拠（誤動作・回帰・必須テスト破損・受入条件未達）があるもの。差戻し対象 |
| P2 / P3 / nit | 改善提案、スタイル、命名、文言、任意の整理。非 blocking。修正必須・差戻し・自動修正・budget 消費の理由にしない |
| 昇格禁止 | 将来仮説・好み・P2 の言い換えを P1 にしない（prompt に明記）。累積 budget（BOXP-369）はそのまま残るので、仮に言い換えが起きても無限反復にはならない |
| blocking 判定 | P0 / P1 が 1 件以上 → 従来どおり `:failure-kind :findings`、retryable、短期 retry と累積 budget を 1 消費 |
| pass 判定 | 所見が P2 / P3 / nit のみ → `codex-review` gate は `pass`。`record-pr-gate-failure!` を呼ばず budget も retry state も消費しない。件数だけを `:low-priority-findings {:count N :paths [...]}` として summary と Notes（「非 blocking の低優先所見 (P2/P3/nit): N 件。参考として review artifact に保持」）に残す。本文は Notes に書かない。後続票は自動で作らない |
| 混在時 | P0 / P1 行だけを `codex-review-<N>-blocking.md` に書き出し、diagnostic detail と retry prompt はこの artifact を指す。retry prompt に「P2/P3/nit は今回の修正条件ではない」と明記し、低優先行は含めない。retry fingerprint の元になる `:message` も blocking 行だけから作るので、同じ P1 の再試行は従来どおり count が累積し、P2 の文言変化で count が戻らない |
| 判定失敗 | review 出力が空 / `CODEX_REVIEW_RESULT` 欠落 / `issues` なのに finding 行ゼロ（severity 欠落＝旧形式）/ 未知の severity → `:failure-kind :invalid-output`、non-retryable。自動合格にも自動再試行にもせず Blocked（正式停止）。category は `codex-review-invalid-output`、`gate-correction` は unknown、budget は消費しない（non-retryable は従来から数えない） |
| `clean` と finding 行が併存 | 矛盾出力。finding 行の severity に従って判定する（P0/P1 があれば blocking、低優先のみなら pass + 件数保持） |
| 変更しない gate | CI / 必須 check / mergeability / conflict / PR URL / 機密 redaction / lock / heartbeat / planned shutdown / 短期 retry 上限 / 累積 budget と grant / `stop-exhausted-ticket!` はすべて従来どおり |

## 変更箇所

- `docker/codex-workspace/task-board/task_board_runner.bb`
  - `run-codex-review!`: prompt に severity 方針と出力形式を追加。`codex-review-findings` / `classify-codex-review` の純関数で判定し、上記 4 分岐（clean / pass-low / blocking / invalid）を返す。blocking artifact を run dir に書く
  - `review-gate!`: 複数 PR の低優先件数と artifact パスを集約して成功 map に載せる
  - `pr-gate-diagnostic` / `persist-pr-gate-diagnostic!`: `codex-review` の detail を「P0/P1 の blocking 所見のみ修正。P2/P3/nit は非 blocking の参考で再試行条件ではない。blocking artifact: <path>」にし、`invalid-output` 用 category を追加
  - `persisted-review-gate-reason` / `persisted-review-gate` / `final-note`: 低優先件数（数値と artifact パスのみ）を Notes / summary に残す
  - `pr-gate-retry-prompt` と agent prompt の review contract: severity 方針（P0/P1 だけが修正条件、P2 以下を P1 に言い換えない）を 1〜2 行追加
  - `bb task_board_runner.bb test`: 分類関数の単体テスト（P1 のみ / P2 のみ / 混在 / P0 / severity 欠落 / 未知 severity / marker 欠落 / clean+finding 併存）と `gate-correction` の `invalid-output -> unknown`
- `tests/codex-workspace/task-board-runner-test.sh`（fake codex の `CODEX_FAKE_REVIEW_MESSAGE` で review 出力を注入）
  - P1 のみ → In Progress へ戻り retry 1/2、`gate-failure-budget.edn` に 1 件
  - P2/P3/nit のみ → Review へ進み、Notes に件数のみ、本文なし、`pr-gate-retries` なし、budget ファイルに失敗なし
  - 混在 → In Progress、blocking artifact に P1 行のみ、次 tick の prompt に blocking artifact パスと方針があり P2 本文がない
  - P0 のみ → In Progress（blocking）
  - severity 欠落（旧形式）/ 未知 severity / marker 欠落 → Blocked、category `codex-review-invalid-output`、budget 非消費
  - 同じ P1 を 2 回（P2 文言は毎回変化）→ count 1/2 → 2/2 → 3 回目で短期上限 Blocked（P2 の変化で count が戻らない）
  - 既存 `test_review_with_codex_review_issue_is_blocked` は旧形式（severity なし）が判定失敗で Blocked になる回帰に置き換える
- `docs/project_docs/BOXP-377/plan.md`（本書）

## 検証

1. `bb docker/codex-workspace/task-board/task_board_runner.bb test`
2. `tests/codex-workspace/task-board-runner-test.sh`（CI `test-codex-task-board-runner.yml` と同じ）。旧実装では新 fixture（P2 のみ pass、混在、invalid）が失敗することを確認する
3. 通常の PR → CI → codex review → merge
4. merge 後: `Build Codex Workspace Image` → Image Updater で codex-workspace pod が再起動。稼働 revision readback は `/opt/codex-workspace/task-board/task_board_runner.bb` の sha256 が main と一致し `classify-codex-review` を含むことで確認。隔離 E2E は fixture の `RUNNER` を稼働版に差し替え、一時 root / 一時 vault で severity fixture を実行する。稼働 root・本番 vault・実票には失敗を注入しない

## 安全条件

新権限 / 秘密取得 / 課金 fallback / 外送信 / Hermes 再起動 / 実票への失敗注入 / active 強制停止 / lock 削除 / 予算直接編集はしない。
360 / 376 の停止条件は維持し、本票への付替えで累積上限を迂回しない。
