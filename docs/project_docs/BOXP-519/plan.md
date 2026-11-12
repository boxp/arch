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
