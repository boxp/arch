# BOXP-44 Claude cron runner

`daily-hitohako-news-novel` を Cursor Agent ではなく Claude Code で実行できるように、Codex workspace cron の runner に `claude` を追加する。

## Scope

1. `docker/codex-workspace/cron/run-codex-cron.sh` に `claude` runner を追加する。
2. `claude` runner は Claude Code CLI を `--print --output-format text` で実行し、job の `model` を `--model` に渡す。
3. `bypass-approvals` が true の場合は Claude Code の permission bypass を使う。
4. `cursor` と同様に text output を `stdout.log` に保存し、`last-message.md` にコピーする。
5. bundled `codex-workspace-cron` skill docs に `claude` runner の例を追加する。

## Validation

1. `bash -n docker/codex-workspace/cron/run-codex-cron.sh`
2. fake `claude` executable と一時 cron root を使い、`runner: claude` の job が `claude_args` と `last-message.md` を出力することを確認する。
3. live Obsidian vault の `daily-hitohako-news-novel` は、runner 実装がデプロイされるまで `runner: cursor` のまま維持する。先に `runner: claude` へ変更すると現行 `/opt/codex-workspace/cron/run-codex-cron.sh` が unsupported runner として失敗するため。

## Follow-up

この PR が merge され、codex-workspace image が再デプロイされた後に、以下で job 定義を切り替える。

```bash
bb ~/.codex/skills/codex-workspace-cron/scripts/codex_cron_jobs.bb update daily-hitohako-news-novel \
  --runner claude \
  --model claude-4.6-sonnet-medium
```

その後、次回 run または手動 run の `metadata.env` で `runner=claude` と `claude_args=... --model claude-4.6-sonnet-medium` を確認する。
