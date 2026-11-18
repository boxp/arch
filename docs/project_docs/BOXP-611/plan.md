# BOXP-611: 任意委譲を既定として確定し BOXP-604 trial 表記を整理する

## 背景
- BOXP-604 の初回評価（T0±24h）で、戻す条件に当たらず「optional のまま続ける」を推奨。
- Owner が選択 1（optional を既定として確定）を承認（家経由 reply_id=07a190fc…「推奨通りで」）。
- 評価メモ: Obsidian `Projects/model-usage-attribution/delegation-optional-trial.md` §9.5。

## 変更
- `task_board_runner.bb`: Claude 親向け prompt の「(BOXP-604 trial)」表記を外す
  - `- Codex delegation is optional for this run: ...`
  - `Optional delegation: this run has no mandatory Codex delegation ...`
- 同ファイルの説明コメントを「BOXP-604 で試行し BOXP-611 で既定確定。総合節約は未確証、戻す目安の監視は続ける」に更新。
- テスト（runner-test / harness_eval test）の期待文言を更新し、「BOXP-604 trial」が出ないことを確認する。

## 変えないもの
- 既定値 `optional`、`CODEX_TASK_BOARD_DELEGATION_MODE=required` での復帰経路、対象エージェント、
  独立 codex review・PR gate・予算・再試行上限、親の任意サブエージェント利用。
- required への復帰、追加の観察予約、新しい課金権限は含まない。

## 確認
- CI（test-codex-task-board-runner）通過、codex review gate。
- merge 後に codex-workspace image を更新（lolice）し、配備後の実 run の prompt.md に
  「(BOXP-604 trial)」が無く「Codex delegation is optional for this run:」があることを読み戻す。
