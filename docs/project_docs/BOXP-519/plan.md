# BOXP-519: 完了票の古いrunの再生成可能 dist/node_modules 限定自動回収

正本: Obsidian `Projects/storage-alert-triage-20261112/approved-generated-output-auto-reclaim`（Owner A承認, BOXP-518 event）。

## 背景
- 既存 prune は done 票の run を `within-retention`（閉票から3日）/ stale 側 12h・最新2本保持で丸ごと保持する。
  done 直後の大容量 run（Studio dist/node_modules）は数時間〜数日回収されない。
- BOXP-518 は手動で20件4.729GiBを回収した。本票はその限定規則を runner の正規 prune に統合する。

## 方針（run/worktree 全体の保持期間は変えない）
prune-workspaces! の通常パス後に `generated-reclaim` パスを追加し、以下を全て満たす場合のみ checkout 内の生成物ディレクトリだけを削除する。

### 票/run 条件（削除直前に lock guard 下で再確認）
- 票の lock ファイルが無い（active run なし）、Board 上カードがちょうど1枚で Done レーン、frontmatter `status: done`。
- run-id が解析可能、票内の最新 `keep-latest-runs`（既定2）本に含まれない、開始から `CODEX_TASK_BOARD_GENERATED_RECLAIM_MIN_AGE_HOURS`（既定1h）以上経過。
- `safe-run-workspace-path?`、stale-process-hold（mount/cwd）なし。

### 対象（これ以外は一切削除しない）
- `node_modules/`：git が ignored と判定した完全一致ディレクトリ。同階層の `package.json` とロックファイル（package-lock.json / npm-shrinkwrap.json / pnpm-lock.yaml / yarn.lock）が追跡かつ未変更。
- `apps/kohako-studio/web/dist/`（boxp/arch）：既存 `studio-dist-hold` が nil（public と byte 一致、入力追跡）かつ入力が未変更。
- `apps/kohako-studio/bff/dist/`（boxp/arch）：既存 `bff-dist-hold` が nil かつ入力が未変更。

### 保持（候補単位で fail-closed）
- 候補内に追跡ファイル / ネストした checkout / hardlink（nlink>1）/ symlink 自体の候補 / 実パスが checkout 外。
- run 内（候補外）の symlink が候補内を指す（共有依存）。
- 入力の dirty、git エラー、計測・走査失敗。
- 未知 ignored やそれ以外の dirty/未push 成果は削除対象外として残す（run 全体は既存 prune の規則のまま）。

### 運用
- モード: `~/.codex-task-board/generated-reclaim.edn` `{:mode :off|:dry-run|:on}` が env `CODEX_TASK_BOARD_GENERATED_RECLAIM` より優先。既定は `on`（PR 前に実環境 read-only dry-run で候補/保持理由とエラー無しを確認済み）。`{:mode :dry-run}` で非削除観察に切替可。
- rollback: flag を `{:mode :off}`（即時）または PR revert。
- 計測: 候補ごとに du allocated（hardlink 除外のため一意）を `metrics/workspace-capacity.edn` に `:generated-reclaim` event、パス毎に `:generated-reclaim-summary`（件数/bytes/保持理由/fs-free 前後）。1パスの削除上限あり。

## 検証
- Red/Green 回帰: 安全 Done 旧 run で対象のみ回収・原本存続、最新/lock/非Done/複数カード/dirty入力/未知/hardlink/symlink依存/ネストgit/内容不一致は保持、dry-run 非削除、再実行冪等、削除直前の票状態変化で非削除。
- 既存 prune/stale/BFF/carryover テスト維持、CI。
- merge → image 配備 → dry-run 実候補 → `:on` → 実回収台帳/前後df/保護存続/業務継続 → 複数tick観察。

## 実環境 dry-run（PR 前, 2026-11-12 09:5xZ, metrics off, 非削除）
- summary: would-reclaim 0 / held 0、skipped-tickets ticket-missing 13・not-single-done-card 32・locked 1、skipped-runs latest-run 118・run-id-timestamp-unparseable 7。
- 現存 Done 票の run は既存 stale prune（12h・最新2本）と BOXP-518 応急回収で最新2本のみ残存しており、本パスの現時点の対象は 0（成功の捏造ではなく対象不在）。
- 残存 dist/node_modules は 非Done 票（BOXP-407/276/425/391 等）、checkout 外の検証素材（pwarms/pwv 等）、検証規則の無い `apps/hitohako/dist` で、いずれも設計どおり保持。
- 効果が出るのは Done 後 12h 以内に古い run が複数残る局面（BOXP-510 の 13 run のような burst）。配備後の複数 tick で gross 生成/回収/純増を観察する。

---

## TD-01 再計画（2026-11-12 Owner「再計画して対応して」）

### 再測定（2026-11-12 10:20 UTC, codex-workspace-home ext4 98.3G）
- 使用 80.66GiB / 空き 17.6GiB。上位: `.codex-task-board/workspaces` 40.84GiB、`b441work` 10.22GiB（既知保護）、`ghq` 7.54GiB、`.codex` 6.56GiB、`Documents` 5.92GiB。
- workspaces 内訳（票status別）: done 203 run 31.75GiB（>100MB の 49 run で 30.16GiB）、blocked 102 run 8.41GiB、ready 0.94GiB。
- 増加元: boxp/arch の run worktree 1本あたり追跡ファイル約 0.52GB。うち `apps/kohako-studio/web/public`（Live2D/png）497MB、
  256KiB 以上の追跡ファイル 384 個で 497MB。run ごとに Git object と同一内容の複製が作られ、Done 票の最新run保護（latest-run, keep 2）の間ずっと残る。
- 旧 generated-reclaim（dist/node_modules, 非最新run限定）は対象 0。Done 票の非最新 run は既存 stale prune が丸ごと削除済みのため。

### 方針: 完了票 run の大きな追跡ファイルの「脱水」（run/worktree の保持本数・期間は変えない）
- 対象: generated-reclaim と同じ票条件（lock 無し・Board の Done 単一カード・status done）、run は safe path・process hold 無し・
  開始から MIN_AGE 以上。**latest-run でも対象**（worktree/branch/ignored/untracked は残し、再開時に自動復元するため）。
- checkout 条件: `git status --porcelain --untracked-files=all` が空、merge/rebase 等の進行中操作なし、nested checkout 内でない。
- ファイル条件: 追跡の通常ファイル（mode 100644/100755、symlink/submodule 除外）、サイズ >= `CODEX_TASK_BOARD_DEHYDRATE_MIN_BYTES`（既定 262144）、
  link 数 1、既に skip-worktree でない、`git hash-object` が index blob と一致（内容一致の証明＝正本は共有 Git object。gc は worktree index を到達根として扱う）、
  run 内 symlink の参照先でない。
- 実行（ticket lock guard 下で全条件を再確認後）: per-worktree git dir に marker `codex-task-board-dehydrated`（NUL区切りパス一覧）を書く →
  `git update-index --skip-worktree` → ファイル削除。`git status` は clean のまま。
- 復元: reuse / carryover の前に marker があれば、パスが存在しない場合のみ `--no-skip-worktree` + `git checkout-index` で復元し、
  status clean と marker 削除を確認。存在するパスがあれば上書きせず reuse を reject（新規 worktree に fallback）。
- prune: marker のあるcheckoutで脱水パスにファイルが存在する場合は `dehydrated-path-present` で保持（skip-worktree が新規内容を隠すのを防ぐ）。
- フラグ: `generated-reclaim.edn` の `:mode`（off/dry-run/on）に従う。追加で `:dehydrate false` で脱水のみ無効化可能。rollback は `{:mode :off}` または `:dehydrate false`。
  既に脱水済みの run は再開時に自動復元されるため rollback 後も業務影響なし。
- 計測: `:generated-reclaim` イベントに `:kind :tracked-dehydrate`、`:files`、`:allocated-bytes`、サマリに前後 df。

### 期待効果と検証
- Done 票の arch run（約 49 run）× 約 0.5GB ≒ 20GiB 前後を、保持本数/期間を変えずに回収見込み（dry-run で実数確定）。
- 生成重複抑制: 完了後に複製を即時脱水し、再開時のみ復元するため、Done 票の保持期間中に複製が残らない。新規 run 作成時の取得は変えない（作業に必要なため）。
- RedGreen: 脱水→status clean→reuse で復元・status clean、dirty/untracked/hash 不一致/hardlink/symlink 参照/lock/非Done/active は保持、
  脱水パス存在時の prune 保持・reuse reject、dry-run 非削除、冪等（2回目は対象0）。
- 対象外: b441work、blocked/in-progress/ready 票、秘密/session、共有 repo の設定変更（sparse-checkout/worktreeConfig は使わない）、保持期間/本数短縮、Longhorn/拡張。

## 追加: reuse時の検証済みdist破棄による生成重複抑制 (2026-11-12 13:20 UTC)

- 実測: 脱水配備後 df avail 19.95GB(12:18)→9.34GB(13:20)。主因は同一票(BOXP-523)の連続runが毎回 `mode=:new-checkout reason=studio-dist-public-diff` で約1.09GB(追跡public 498MB + 検証済みdist 498MB)の新規checkoutを作り、旧runが最新保護/stale保持で残ること。
- 対策: `try-reuse-repo-worktree!` で `studio-dist-public-diff` / `bff-dist-src-diff` となる場合、ticket lock所有を確認し `studio-dist-hold`/`bff-dist-hold`/`inspect-ignored` で全再生成可能を再検証できたときだけ旧worktreeのdistを削除し、通常reuse(worktree move + base switch)を行う。結果は新規checkoutと同じ「distなし」状態で、追跡ファイル・未知/固有ファイル・branchは不変。
- 監査: `:reuse-base-reason "studio-dist-dropped"` / `"bff-dist-dropped"` を workspace-reuse.edn に残す。
- rollback: `~/.codex-task-board/generated-reclaim.edn` に `{:reuse-drop-dist false}`（または `{:mode :off}`）で従来の拒否動作に戻る。
