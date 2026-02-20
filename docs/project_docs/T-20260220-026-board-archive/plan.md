# T-20260220-026: board.md Done/Rejected アーカイブ自動化

## 概要

board.md の Done/Rejected セクションを毎日 JST 24:00（15:00 UTC）にアーカイブし、
`archived/YYYYMMDD.md` に移す仕組みを構築する。

## 設計

### スクリプト: `docker/openclaw/scripts/archive-board.sh`

**入力**: `$HOME/.openclaw/workspace/tasks/board.md`（環境変数 `BOARD_PATH` で上書き可）

**処理フロー**:
1. board.md から `## Done` と `## Rejected` セクションを抽出
2. `archived/YYYYMMDD.md` にメタデータ付きで書き出し
3. board.md の Done/Rejected セクションをアーカイブ参照リンクに置換
4. `Last Updated:` 行を更新

**出力**: `tasks/archived/YYYYMMDD.md`

**メタデータ（YAML frontmatter）**:
- `archived_at`: アーカイブ実行日時（JST）
- `source`: 元ファイル名
- `done_count` / `rejected_count` / `total_archived`: タスク数
- `archive_file`: アーカイブファイル名

**冪等性**: 同日2回実行した場合、2回目は Done/Rejected にタスクが残っていないためスキップ。

### OpenClaw cron ジョブ設定

```
Schedule: 0 15 * * * (毎日 15:00 UTC = JST 24:00)
Session: isolated
Prompt: "Run the board archive script: bash $HOME/.openclaw/workspace/scripts/archive-board.sh"
```

設定コマンド（手動で1回実行）:
```bash
openclaw cron add \
  --name "board-archive-daily" \
  --schedule "0 15 * * *" \
  --session isolated \
  --prompt 'Run: bash $HOME/.openclaw/workspace/scripts/archive-board.sh'
```

### ディレクトリ構造

```
tasks/
├── board.md                   # アクティブなタスクボード
├── archived/
│   ├── 20260220.md           # 日次アーカイブ
│   ├── 20260221.md
│   └── ...
└── ...
```

### ファイルローテーション

- アーカイブファイルは日付ベースで自動ローテーション
- 同日のアーカイブは上書き（冪等性確保）
- 過去アーカイブは `archived/` ディレクトリに蓄積（削除なし）
- R2バックアップにより永続化

## 変更ファイル

1. `docker/openclaw/scripts/archive-board.sh` - 新規: アーカイブスクリプト
2. `docs/project_docs/T-20260220-026-board-archive/plan.md` - 新規: 本計画書
