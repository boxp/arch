# BOXP-448: 票失敗枠を実PR数×10へ共通実装

## 現状 (arch main 100784d8f / 配備版と同一を diff で確認)

- `docker/codex-workspace/task-board/task_board_runner.bb`
  - `gate-failure-budget-limit` (1744-1751): 基準 10、`CODEX_TASK_BOARD_GATE_FAILURE_BUDGET` は締める方向のみ。
  - `gate-budget-status` (1815-1818): ticket/PR 共通で `基準 + scope別grant`。PR数連動の自動枠は無い。
  - `gate-budget-ticket-pr-ids` (1863-1870): 失敗履歴 + 本文/Notes の PR 参照。用途は PR 枠枯渇判定と PR 排他のみ。
  - 判定箇所: `record-gate-failure-budget!`(失敗記録/停止通知), `gate-budget-exhausted-for-ticket?`(開始前 precheck),
    `reserve-gate-budget-run!`(予約時再check), `stop-exhausted-ticket!`(停止遷移), CLI `gate-budget-status`。
    すべて `gate-budget-status` を通るので、ここで有効上限を一元計算する。
- 同一機能の既存 PR は無し (`gh pr list` 検索)。BOXP-432 は BOXP-428 への手動 grant のみ。

## 新ルール

- unit = `gate-failure-budget-limit` (最大10、env で締めるのみ)。
- N = 対象 ticket の scope PR 数 = 次の distinct canonical PR (`owner/repo#N`, 大文字小文字/URL表記違いは同一)
  - ticket の run が実際に PR gate で評価した PR (失敗・pass・merged skip を含む) を `:pr-registrations` に記録 (ticket+PR で冪等、初回 run/時刻を保持)。
  - 既存の失敗履歴 `:failures` の ticket/PR も登録とみなす (移行: 既存データからそのまま N を算出)。
  - 他票が先に登録/失敗した PR は「他票所有」として除外 (最初の登録 ticket が所有)。
  - Notes の PR リンクだけでは N に数えない (未評価の参考リンク除外)。
  - Owner が `gate-budget-exclude-pr BOXP-N owner/repo#N --by NAME` で除外記録した PR (一時 Red 用 PR・水増し分割など) は除外。記録は追記のみ。
  - merge 後も登録は消えないので N は維持。head 更新/再試行/URL表記違いは重複加算しない。
- ticket 有効上限 = `max(unit × max(1,N), unit + legacy-grants) + additive-grants`
  - legacy-grants = `:kind` を持たない既存 ticket grant (BOXP-448 以前)。N 対応補填か純追加か根拠なく分類できないため、
    「旧有効上限を下回らない最低保証」として扱う (既存有効枠を下げず、N倍基準と二重加算しない)。
  - additive-grants = 新 CLI が `:kind :additive` で記録する grant。常に純加算。
- PR 有効上限 = `unit + PR grant 合計` (従来どおり PR 個別上限 10 を維持)。
- 失敗履歴・grant・予約は削除/reset しない。used/idempotency/PR 排他/lock/continuation 予算は不変。

## テスト

- bb unit/PBT: N=0/1/複数、増加、重複URL、merge後維持、他票所有/参考link/除外PR、legacy/additive grant、env tighten。
- black-box (tests/codex-workspace/task-board-runner-test.sh): 2PR 目で ticket 上限が 20 になる、PR 個別上限 10 維持、再起動(tick毎新プロセス)、既存テスト維持。

## 配備・441

- 通常 CI / codex review (P0/P1 なし) / merge → codex-workspace image 更新 → runner 再起動 → health 確認。
- `gate-budget-status BOXP-441` で N=4 (even-g2-lab#78,#83,#88, arch#14509; 全て BOXP-441 タイトルの PR) /
  旧 10/10 → 新 10/40 を実測し、正規手順で 441 を元担当 (claude-opus) へ戻す。他の Blocked 票 (428 等) は触らない。
