Obsidian vault の定期イベントレジストリを dry-run 評価してください。

実行コマンド:

```bash
bb /opt/codex-workspace/recurring-events/recurring_events.bb dry-run
```

要件:

- apply は実行しない。
- `candidate`, `not-yet`, `disabled`, `already-created`, `invalid`, `needs-human-check` を確認する。
- `candidate` または `needs-human-check` がある場合は、対象 event-id / occurrence-key / 予定レーン / 理由を日本語で要約する。
- `invalid` がある場合は修正すべき frontmatter を日本語で要約する。
