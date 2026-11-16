# BOXP-238: 未使用 llama-vulkan の廃止

owner の「使用されていないのであれば廃止」承認に基づく。関連調査は Obsidian `Projects/BOXP-236/build-triage`、実装結果は `Projects/BOXP-236/llama-vulkan-retirement` に記録する。

## 現在の利用確認（2026-10-16 06:29 UTC）

- arch `97a598b7a` / lolice `134d62b` の origin/main を検索。arch の参照は専用 workflow・lockfile・Dockerfile と過去の計画文書のみ。lolice の参照は過去の計画文書のみで、local-llm は llama-sycl を使用。
- `kubectl get pods -A` の containers/initContainers/ephemeralContainers 計264件、`kubectl get deployments,statefulsets,daemonsets,jobs,cronjobs -A` の containers/initContainers 計160件で llama-vulkan は0件。local-llm の実 image は llama-sycl（digest `8f864379…`）。環境変数・Secret は取得しない。
- arch の open PR 5本 / lolice 0本に関連する変更なし。専用 workflow の直近10 run はすべて completed（最新は2026-10-15の親票PRで失敗）。

## 実装と検証

1. 専用 worktree で `docker/llama-vulkan/` と `.github/workflows/build-llama-vulkan-image.yml` を削除。
2. `gh actions-lock --no-interactive --no-narrow --no-migrate-local-actions` で lockfile を再生成し、専用 workflow の6行だけが消えることを確認。Renovate の専用ルールはなく、Dockerfile 削除で自動検出対象から外れる。
3. 過去の計画文書は履歴として残す。llama-sycl、Hermes、sdnext-ipex と共通CI定義は変更しない。
4. actionlint / ghalint / trivy、lock検証、差分範囲確認、独立した Codex review を実施。通常PRで関連CIの成功を確認し merge。
5. main に対象定義と build trigger がないことを確認し、Obsidian に根拠・PR/CI・残存リスク・復旧方法を記録して親237 Notesへリンクする。親236のDoneと237のsdnext修復判断は維持する。

## 残存リスクと復旧

公開済み GHCR package/tag/image は削除しない。旧 `llama-vulkan:latest` は更新されなくなり、親調査で指摘された脆弱なlibcurl等を含むため再利用非推奨。定義廃止だけでは既存imageのpullや過去のlolice設定による再利用を防げない。

復旧が必要なら本PRのmerge commitを通常のrevert PRで取り消し、review/CIを経てmergeする。復旧時には削除されたworkflowのpush triggerによるbuild/publishが再開し得るため、ownerと復旧方針・既知のビルド破損/脆弱性への対応を確認する。旧imageの再利用、稼働変更、package削除は本作業に含めない。
