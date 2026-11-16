# BOXP-494: 容量対策案2 S1 — 作業領域の継続引継ぎと容量計測

Owner 承認（BOXP-493 done 通知への回答 A）に基づく段階実装 S1。根拠は vault の
`Projects/codex-workspace-disk-growth/staged-implementation-s1.md` と `fable-review-BOXP-493.md`。

## 変えること
1. **継続引継ぎ（carryover）**: 同一票・同一 repo の次 run が、前 run の worktree を
   `git worktree move` でそのまま引き継ぐ。HEAD・branch・index・未保存差分・untracked・
   ignored・未 push commit・reflog を一切変更しない（switch/reset/clean/reflog expire/旧 branch 削除をしない）。
   - 再利用の可否は「安全に動かせるか」だけで判定する: process/cwd・mount（fail-closed）、
     lock 所有の再確認、パス安全性、入れ子 checkout、worktree 構造（toplevel/common-dir/origin）、
     git 操作途中（merge/rebase 等）、`.venv`。
   - dirty / 未 push / 未知 ignored は再利用拒否の理由にしない（回収可否とは別判定）。GitHub 照会もしない。
   - 移動前後で HEAD と `git status` を比較し、不一致なら元へ戻す。何も削除しない。
   - prompt に継承元 run・HEAD・未保存件数を示し、reset/clean で消さないよう指示する（ファイル名は出さない）。
2. **段階 flag と rollback**: `$CODEX_TASK_BOARD_ROOT/workspace-carryover.edn`
   (`{:mode :off|:canary|:on :tickets [...]}`) を run 開始ごとに読む。無い場合は env
   `CODEX_TASK_BOARD_WORKSPACE_CARRYOVER`（既定 off）。不正値は off（従来動作）。
   `:off` に戻すと次 run から従来の再利用判定に戻り、引継ぎ済みの dirty 作業領域は従来どおり保持される。
3. **容量計測**（`CODEX_TASK_BOARD_WORKSPACE_METRICS`、既定 on）: `$ROOT/metrics/workspace-capacity.edn` に
   - run 準備: 引継ぎ/再利用（移動・新規複製 0）か新規 checkout（`git ls-tree -l` の blob 合計による推計 bytes）かと fallback 理由
   - prune: 削除 run の削除前 `du`（見掛け/実割当、上限は回収量の上限推計）、hold run の理由別 bytes（6h キャッシュ、1 pass の du 回数上限）、未計測件数、FS 空き
   - `workspace-metrics --since-hours N` で生成/回収/純増（推計）を集計

## 変えないこと
既存の削除条件・保持時間（12h/3日）・最新2本保護・guard 閾値・権限。S2/S3（中身判定の回収、bytes 予算、段階 guard）と
S4（退避回収）は S1 の実測を示した後の別判断。Fable 提案値（4GB/36GB/16GiB/4GiB/5%）は閾値として有効化しない。

## 検証と配備
- fixture で Red/Green: dirty/untracked/ignored/未 push/index/custom branch/detached の全保持（hash 比較）、
  安全 fallback（process/mount/lock/nested/venv/merge 中/構造不一致）、flag mode と rollback、連鎖・異常終了後の再開、
  別票/別 repo、prune との相互作用（計測 on/off で判定不変）、計測の上限・失敗時無害。
- 通常 CI・独立 P0/P1 review → merge → image 配備 → canary（`BOXP-476` 等）で実 run の引継ぎを確認 → `:on`。
- 短期確認と 48h・7 日の傾向を分けて報告し、S2/S3 の試験根拠を示す。
