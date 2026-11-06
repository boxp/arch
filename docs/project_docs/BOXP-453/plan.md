# BOXP-453 設計・削除契約（run 蓄積と容量枯渇の再発防止）

2026-11-06 作成。前提: [[Projects/codex-workspace-disk-growth/current-owner-summary|BOXP-451 調査]] / [[Projects/codex-workspace-disk-growth/cleanup-BOXP-452|BOXP-452 回収]]。PVC は 100Gi 維持（lolice `argoproj/codex-workspace/pvc.yaml` も 100Gi で一致、IaC 変更不要）。

## 1. 未完了票の古い run の回収（stale-run prune）

対象: Done 以外のレーン（Ready / Blocked / Backlog / In Progress 等）の票の run。

削除してよい条件（すべて満たす場合だけ）:
- 票のロック（実行中 run）が無い。ロックがあれば票ごと skip（現行どおり）。
- その票で **最新の run ではない**（run-id の時刻で新しい順に `KEEP_LATEST`（既定 2）本は保護）。
- run 開始から `STALE_RUN_RETENTION_HOURS`（既定 12h）以上経過。
- 既存の done prune と同じ検査をすべて通る: 未 commit なし、stash なし、reflog を含む全 commit が GitHub に存在、git エラーなし。
- **ignored ファイルの検査（新規）**: `git status --porcelain --ignored` に出る ignored パスが、すべて再生成可能な allowlist（`node_modules/` `.terraform/` `.cpcache/` `.clj-kondo/.cache/` `.lsp/.cache/` `__pycache__/` `.pytest_cache/` `.mypy_cache/` `.ruff_cache/` `.venv/` `.next/` `.turbo/` `.gradle/` `target/` `.shadow-cljs/` `.eslintcache`）配下のときだけ削除。それ以外の ignored（制作物・実験出力・.env 等）は `hold ignored-unknown`。
- run 配下に他の mount point がない、run 配下を cwd とするプロセスがない（不明なら hold）。
- symlink は辿らない（現行どおり）。hardlink は unlink のみで実体は他参照が残る。

保持: hold 理由は従来どおり 1 行ログ。branch 削除は既存 `prune-run-branch!`（GitHub に無いものは残す）に従う。既存 hold 52 本の一括解除はしない。

## 2. done 票の retention

done prune（3 日）は維持。ただし done 票にも上記 ignored 検査を適用せず現行挙動のままにする（既存承認の範囲を変えない）。done 票でも最新以外の古い run は §1 の stale 条件で前倒し回収できる（最新 2 本は 3 日保持）。

## 3. 容量ガード（新規 run 開始前）

- tick で新規 candidate を起動する前に `root` の空きバイト・空き inode を確認。
- 空き < `MIN_FREE_BYTES`（既定 8GiB）または空き inode < `MIN_FREE_INODE_PERCENT`（既定 3%）なら **新規 run を開始しない**（claim しない＝retry/continuation 予算を消費しない、card は元レーンのまま）。ログ `disk-guard: ...` を 1 行。
- 同時に prune を interval を待たず即時起動（実行中なら重ねない）。prune・in-flight run の結果保存・lock 回復はガード対象外なので、満杯でも回収経路は閉じない。
- 測定失敗時は fail-open（現行どおり開始）してログ。
- prune interval 既定を 6h → 1h に短縮。

## 4. 監視

kube-prometheus 標準 `KubePersistentVolumeFillingUp`（残 3%/ 4 日以内予測）・`KubePersistentVolumeInodesFillingUp` が独立監視として既存。新規 cron / LLM 巡回は追加しない。

## 5. やらないこと

PVC 拡張・縮小、他ディスク掃除、hold 一括解除、失敗台帳 reset、worktree 再利用の大規模再設計（stale prune で 1 票あたり保持量を上限化することで代替）。
