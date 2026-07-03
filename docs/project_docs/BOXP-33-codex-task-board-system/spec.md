# Codex Task Board system

## Source of Truth

Task Board のレーンを状態の source of truth とする。runner は tick の開始時に board を読み、カードが置かれているレーンから正規 `status` を決める。チケット frontmatter `status` とカード内 `status::` が異なる場合は、レーンに合わせて補正する。

runner は Task Board カードを処理結果に応じて移動するが、Codex prompt には「カードを直接移動しない」ことを明記する。並列 run 中の board 書き戻しは runner 内で直列化し、移動直前に board を読み直して対象カードだけを移動する。

## Trigger

チケット frontmatter `assignee: codex` を Codex 起動トリガーにする。`assignee` が `codex` 以外の場合、runner は Codex run を開始しない。

| レーン | assignee | runner action |
| --- | --- | --- |
| Backlog | codex | 要件整理 run を開始し、完了後 Ready へ移動する |
| Ready | codex | 再開指示として In Progress へ移動し、実装 run を開始する |
| In Progress | codex | 実装 run を開始する |
| Review | codex | レビュー対応として In Progress へ移動し、修正 run を開始する |
| Blocked | codex | ブロッカー再調査として In Progress へ移動し、再試行 run を開始する |
| Done | any | Codex run は開始しない |

Codex run 終了時、runner は `assignee: boxp` に戻し、人間の確認点に置く。完了時は `closed: YYYY-MM-DD` と card `done::YYYY-MM-DD` を設定する。

## Parallelism and Locking

1 tick で見つかった候補チケットはチケットごとに独立した Codex process として並列起動する。同じチケットだけは `/home/boxp/.codex-task-board/locks/<ticket>.edn` による ticket lock で二重実行を防ぐ。

active lock があるチケットはそのチケットだけ skip し、他チケットの並列起動を止めない。lock は `ticket`, `run-id`, `action`, `lane`, `host`, `pid`, `started-at`, `heartbeat-at` を保持する。

## Stale Lock Recovery

runner は tick 冒頭と lock 取得時に stale lock を判定する。`heartbeat-at` が `CODEX_TASK_BOARD_LOCK_STALE_SECONDS` を超えて古い場合、前回 run summary を `interrupted` に更新し、Notes に heartbeat timeout を記録して lock を削除する。

stale lock の削除後は、古い run state ではなく現在の Task Board レーンと `assignee` を読み直して処理を決める。壊れた lock EDN は当該 lock だけを隔離対象として削除し、他チケットの処理は継続する。

## Run Workspace

各 run は `/home/boxp/.codex-task-board/workspaces/<ticket>/<run-id>/` を作業ディレクトリにする。チケット frontmatter `repo:` に `owner/name` がある場合、runner は `/home/boxp/ghq/github.com/<owner>/<name>` から per-run git worktree を作る。

local checkout が存在しない、または worktree 作成に失敗した場合、runner は即 blocked にせず、その事実を prompt に含めて Codex に準備を委ねる。

## Review Gate

repository 変更を伴う作業を Review に進める場合、Codex は GitHub PR URL を final message に含める。repository 変更がない review の場合だけ、`TASK_BOARD_REVIEW_PR: none` を明示できる。

runner は `TASK_BOARD_RESULT: review` を受け取っても、GitHub PR URL または `TASK_BOARD_REVIEW_PR: none` が見つからない場合は Review へ移動せず Blocked へ戻し、Notes に理由を残す。

## Persistence

runner state は home PVC 上の `/home/boxp/.codex-task-board` に保存する。

```text
/home/boxp/.codex-task-board/
├── locks/
│   └── BOXP-40.edn
├── runs/
│   └── BOXP-40/
│       └── 20260703T120000Z/
│           ├── prompt.md
│           ├── events.jsonl
│           ├── stderr.log
│           ├── last-message.md
│           └── summary.edn
└── workspaces/
    └── BOXP-40/
        └── 20260703T120000Z/
```

チケット Notes には、人間が Task Board 上で判断できる開始、停止、完了、PR、検証結果、次アクションだけを追記する。
