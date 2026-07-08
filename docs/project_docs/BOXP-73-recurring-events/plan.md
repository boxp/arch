# BOXP-73 recurring events registry

Obsidian vault に人間が編集できる定期イベントレジストリを追加し、Codex Workspace から dry-run / apply できる evaluator を `boxp/arch` の codex-workspace image に同梱する。

## Scope

1. Vault layout を `Infrastructure/Recurring Events/` に固定する。
2. Event note frontmatter, `state.edn`, generated ticket, Task Board card, dry-run status を README とテンプレートに明文化する。
3. `docker/codex-workspace/recurring-events/recurring_events.bb` を追加し、`cron` と明示 `occurrences` を評価できるようにする。
4. apply は ticket 一時ファイル作成、Task Board 差し込み、ticket 本配置、state 更新の順で行う。
5. Codex Workspace Cron は disabled dry-run job から始め、apply 有効化は別判断にする。
6. Fresh workspace 用に `docker/codex-workspace/recurring-events/vault-seed/` へ README, template, sample events, `state.edn`, Cron prompt/job を同梱する。entrypoint は既存 vault ファイルを上書きせず、既存 Task Board vault では sample event notes を追加しない。既存 `jobs.edn` がある場合は他ジョブを保持したまま `recurring-events-dry-run` だけを未登録時に追記する。
7. `CODEX_TASK_BOARD_VAULT` を指定した workspace では、Codex Cron の root も同 vault 配下の `Infrastructure/Codex Cron` として解決し、entrypoint の job 登録先と scheduler の読み取り先を一致させる。`CODEX_CRON_ROOT` が指定されている場合は明示値を優先する。

## Validation

- `tests/codex-workspace/recurring-events-test.sh`
- `bash -n tests/codex-workspace/recurring-events-test.sh`
- `bb docker/codex-workspace/recurring-events/recurring_events.bb --vault /home/boxp/Documents/obsidian-headless/BOXP dry-run`
