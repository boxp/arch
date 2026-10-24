---
name: obsidian-task-board
description: Claude / Codex / Pi Agent / hermes-agent workflow for safely listing, showing, creating, updating, deleting, and requesting Codex work for the Obsidian Task Board. Use when the user asks to operate BOXP tickets, Boards/Task Board.md, or Tickets/BOXP-*.md.
---

# Obsidian Task Board

Use this skill only through the bundled helper script. Do not manually edit `Boards/Task Board.md` or `Tickets/BOXP-*.md` unless the helper reports an unrecoverable format problem.

Default vault:

```bash
/home/boxp/Documents/obsidian-headless/BOXP
```

Helper:

```bash
if [ -x "$HOME/skills/note-taking/obsidian-task-board/bin/task-board.bb" ]; then
  TASK_BOARD_HELPER="$HOME/skills/note-taking/obsidian-task-board/bin/task-board.bb"
elif [ -x "$HOME/.claude/skills/obsidian-task-board/bin/task-board.bb" ]; then
  TASK_BOARD_HELPER="$HOME/.claude/skills/obsidian-task-board/bin/task-board.bb"
elif [ -x "$HOME/.codex/skills/obsidian-task-board/bin/task-board.bb" ]; then
  TASK_BOARD_HELPER="$HOME/.codex/skills/obsidian-task-board/bin/task-board.bb"
elif [ -x "$HOME/.pi/agent/skills/obsidian-task-board/bin/task-board.bb" ]; then
  TASK_BOARD_HELPER="$HOME/.pi/agent/skills/obsidian-task-board/bin/task-board.bb"
else
  TASK_BOARD_HELPER="$HOME/ghq/github.com/boxp/dotfiles/.claude/skills/obsidian-task-board/bin/task-board.bb"
fi
```

## Safety Rules

- Treat the Task Board lane as the source of truth for ticket status.
- Keep ticket frontmatter `status` and board card `status::` synchronized with the lane.
- Preserve unspecified ticket fields and existing `## Notes` content.
- Use `--dry-run` before destructive or broad changes.
- `delete` requires `--dry-run` or `--confirm`; prefer dry-run first and report the affected ticket file and board card.
- Do not move Codex requests to `In Progress`. The runner owns that transition.

## Commands

List tickets:

```bash
"$TASK_BOARD_HELPER" list --vault /home/boxp/Documents/obsidian-headless/BOXP --json
"$TASK_BOARD_HELPER" list --vault /home/boxp/Documents/obsidian-headless/BOXP --lane Ready --json
```

Show a ticket:

```bash
"$TASK_BOARD_HELPER" show BOXP-55 --vault /home/boxp/Documents/obsidian-headless/BOXP --json
```

Create a ticket:

```bash
"$TASK_BOARD_HELPER" create \
  --vault /home/boxp/Documents/obsidian-headless/BOXP \
  --title "Short title" \
  --summary "What should be achieved." \
  --lane Backlog \
  --priority medium \
  --assignee boxp \
  --dry-run
```

Update only explicit fields:

```bash
"$TASK_BOARD_HELPER" update BOXP-55 \
  --vault /home/boxp/Documents/obsidian-headless/BOXP \
  --priority high \
  --assignee boxp \
  --summary-file /tmp/summary.md \
  --dry-run
```

Append a timestamped note without deleting existing Notes:

```bash
"$TASK_BOARD_HELPER" append-note BOXP-55 \
  --vault /home/boxp/Documents/obsidian-headless/BOXP \
  --source hermes-agent \
  --note "追加調査条件を確認した。"
```

Request Codex work while preserving the stop lane:

```bash
"$TASK_BOARD_HELPER" request-codex BOXP-55 \
  --vault /home/boxp/Documents/obsidian-headless/BOXP \
  --lane Review \
  --note "レビュー指摘に対応して。CI と codex-review も確認する。" \
  --dry-run
```

Delete dry-run:

```bash
"$TASK_BOARD_HELPER" delete BOXP-55 \
  --vault /home/boxp/Documents/obsidian-headless/BOXP \
  --dry-run
```

Preview a control request (dry-run only):

```bash
"$TASK_BOARD_HELPER" control-intent BOXP-55 --intent run --expected-revision 3 --dry-run
"$TASK_BOARD_HELPER" control-intent BOXP-55 --intent pause --actor runner --writer-generation 1 --expected-revision 3 --dry-run
```

`control-intent` only prints the request that an authenticated control API would receive and the single actor allowed to send it. `--actor owner` (the default) previews `:update-control` and may set any intent. `--actor runner` previews `:restrict-intent`, requires `--writer-generation`, and can only tighten to `pause`, `cancel`, or `wait-human`. The command never writes to the vault and refuses to run without `--dry-run`: editing a ticket, Notes, or frontmatter is not an authorization for autonomy v2 intent, decisions, or retries. Decision answers and retry changes have no control operation yet, so the helper has no preview for them.

## Codex Request Workflow

- Backlog: requirements grooming request. Keep the card in `Backlog`, set `assignee: codex`, and append the request to Notes.
- Ready: implementation start request. Keep the card in `Ready`, set `assignee: codex`, and append the request to Notes.
- Review: review feedback request. Keep the card in `Review`, set `assignee: codex`, and append the feedback to Notes.
- Blocked: retry or blocker re-check request. Keep the card in `Blocked`, set `assignee: codex`, and append the new condition to Notes.

The Task Board runner specification is the operational source for lane behavior:

```text
Projects/codex-task-board-runner/spec.md
```

### Codex assignee と reasoning level

既存の `codex`、`codex-sol`、`codex-full`、`codex-terra`、`codex-mini`、`codex-astra` はそのまま使用できます。割当先モデルは次のとおりです。

- `codex` / `codex-terra`: `gpt-5.6-terra`（既定、コスト重視）
- `codex-sol` / `codex-full`: `gpt-6.1-sol`（高難度タスク向け）
- `codex-mini`: `gpt-5.6-luna`（軽量）
- `codex-astra`: `gpt-6-astra`（最高性能・最高コスト）

これらには必要に応じて `-minimal`、`-low`、`-medium`、`-high`、`-xhigh` を付加できます。ただし `codex-sol` / `codex-full` は `-low`、`-medium`、`-high`、`-xhigh` のみ、`codex-astra` は `-low`、`-medium`、`-high` のみ有効です。例えば `assignee: codex-sol-high` は `gpt-6.1-sol` を選び、Codex CLI に `model_reasoning_effort=high` を明示します。

サフィックスなしの既存名は runner から reasoning を強制せず、Codex の既存設定を使います。未知のベース名または許容外の suffix は実行対象になりません。`fable` は reasoning suffix を受け付けず、従来どおり `fable` のみが有効です。

### localllm assignee（文書更新専用、BOXP-277）

`assignee: localllm` は lolice の local-llm（llama-server, Gemma 4 `gemma4-26b`）で **vault 内ノートの限定更新だけ** を行う経路です。コード変更・PR・shell 実行は行いません。次の条件を満たす票だけが実行されます。

- frontmatter に `docs-target: <vault 相対 path.md>`（カンマ区切りで最大 3 件）を明示する。未設定の票は `Blocked` に理由付きで停止します。
- `docs-target` は runner の許可 root（既定 `Projects/task-board-localllm-docs/pilot`、env `CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS`）配下の Markdown で、`..`・symlink・vault 外は拒否されます。
- 多数の資料を参照して別ノートを更新する依頼は、frontmatter に `docs-sources: <参照フォルダ or ノート（vault 相対、カンマ区切り）>` を書く。runner は資料群の index（path / タイトル / 見出し）だけを model に渡し、model の search（語句一致）と節単位の read を有限回（既定 6 回・根拠 14,000 字）中継してから編集させる。資料は読み取り専用で、参照許可 root（既定 `Projects/task-board-localllm-docs` 配下、env `CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS`）外・symlink は拒否。採用した事実の出典（読んだノートの path）が無い提案は適用されず、Review の Notes に出典と調査量（回数・読んだ資料）が記録される。
- 対象レーンは Ready / In Progress / Review / Blocked。Backlog の groom は行いません。Review に置いて再割当すると Notes 末尾の指示で改稿します。
- 結果は常に `Review`（変更適用、担当 `boxp`）または `Blocked`（未適用、理由付き）で、`Done` にはなりません。model に到達できない場合も cloud agent へは切り替えません。
- 変更は構造化差分（節の差替え / 追記 / 一意テキスト置換）だけで、frontmatter 不変・編集範囲外のリンク保持・コードフェンス整合・競合（base hash）検査・原本 backup・原子的保存を runner が強制します。
- 証拠は run ディレクトリの `localllm-audit.edn` / `llm-evidence.edn`（非秘密メタのみ）。元に戻すには `task_board_runner.bb localllm-rollback BOXP-N RUN-ID`。

依頼例（Ready レーン）:

```text
assignee: localllm
docs-target: Projects/task-board-localllm-docs/pilot/runbook.md
docs-sources: Projects/task-board-localllm-docs/refs   # 任意: 多数資料から更新するとき
```

Summary / Context に「どの節を、どの事実で、どう変えるか」を具体的に書きます。曖昧な依頼は model が `needs-human` を返し `Blocked` になります。設計・評価・採否は vault `Projects/task-board-localllm-docs/README.md` を参照。

#### 設定提案 mode（`docs-mode: propose`、創作設定の加筆案）

既存の設定資料（世界観・人物・年表・決定記録）を参照して **新しい設定の案** を別ノートへ書き足す用途は、frontmatter に `docs-mode: propose` を加えます（既定の `transcribe` は資料にある事実の転記専用で、資料に無いことは書きません）。

- model は資料を調査したうえで「参照した既存設定（読んだ資料の出典付き）」「新規提案」「矛盾・要確認」「人への質問」を返し、runner が対象ノートの末尾に **`## 提案（未承認）BOXP-N` 節を 1 つだけ** 追加します。既存本文（canon）は構造上変更されず、未承認の案が自動で canon になることはありません。採用するときは人が本文へ反映して節を削除します。
- 同じ票を Review に置いて再割当すると、Notes 末尾の指示で案を改稿し、同じ節を置き換えます（節が増えない）。
- 「資料に無い」は停止理由になりません。`needs-human` になるのは対象の人物・事物が判別できない依頼、設定提案でない依頼（ファイル操作・チケット操作・秘密情報）、canon 本文そのものの書き換え・削除だけを求める依頼です。
- 案と根拠を照合する自動検査を 1 回行い、見つかった食い違いは「（自動検査）」付きで矛盾・要確認に入ります（人の確認を置き換えるものではありません）。
- 出典は runner が実際に読んだ資料の path だけ、架空ノートへの wikilink は平文化されます。`docs-target` は 1 ノートだけ（未存在なら提案節だけの新規ノート）。`docs-sources` を省略した票は runner 設定の既定 corpus（env `CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES`、未設定なら調査なし）を使うので、毎回資料を列挙する必要はありません。

依頼例:

```text
assignee: localllm
docs-mode: propose
docs-target: Projects/task-board-localllm-docs/pilot/setting/characters/yui.md
docs-sources: Projects/task-board-localllm-docs/refs/setting, Projects/task-board-localllm-docs/pilot/setting   # 省略時は既定 corpus
```

Summary には「誰の・何の設定案を・どのノートへ」を自然文で書けば足ります（例: 「ユイの冬祭り用の新しい衣装の設定を考えて、ユイのノートに加筆案として書いてほしい。普段の色遣いを引き継ぐこと」）。

## Failure Handling

If the helper refuses a change, report the exact command and error. Common causes are missing ticket files, malformed frontmatter delimiters, missing board lanes, or multiple board cards for one ticket. Prefer `show` and `list --json` to inspect state before retrying.
