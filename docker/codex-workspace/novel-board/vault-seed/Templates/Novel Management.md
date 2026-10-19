---
id:
type: novel
status: backlog
title:
assignee: boxp
nsfw: false
series:
episode:
continuity:
work-dir:
manuscript:
illustration:
llm-model:
last-run:
published-path:
published-at:
---

# Novel

このノートは `Boards/Novel Board.md` のカードと1対1で管理する。状態変更は Board のレーンを先に移動し、runner に `status` を同期させる。初稿・改稿本文はこのノートへ貼らず、`manuscript` の private file を使う。

## Workflow

- `Backlog`: 本文を書かず、Requirements と Outline を整理する。
- `Draft`: 執筆条件を人間が確認する。執筆開始時だけ Board のカードへ対応 agent（`localllm` / `claude-fable` など）を割り当てる。
- `In Progress`: 同じ private 原稿で初稿または改稿を進め、本文検証後に runner が挿絵を生成する。
- `Review`: 人間が原稿と挿絵を確認する。改稿時は `Review Instructions` を記録して agent を割り当て、承認時だけ人間がカードを `Done` へ移す。
- `Done`: agent は再実行せず、runner が承認済み原稿と挿絵をカードの `#nsfw` に従って一度だけ完成版へ配置する。

カードのレーンが source of truth であり、このノートの `status` / `assignee` を直接変えても遷移しない。停止理由と再開条件は `Run History`、改稿指示は `Review Instructions`、原稿の変更内容は `Change History` に残す。

連作の場合は `series`（連作名）、`episode`（話数）、`continuity`（vault 内の整合メモのパス。例: `Projects/運動会連作/README.md`）を frontmatter に書くと、runner が設定・伏線・人物の知識状態の引き継ぎとして context に含める。

## Requirements

- Title:
- Synopsis:
- Characters:
- Style and point of view:
- Target readers:
- Target length:
- Required elements:
- Prohibited elements:
- References: (vault 内の設定ノート/ディレクトリを `ひとはこさんバース/キャラ設定/` のようにバッククォートまたは `[[リンク]]` で列挙。挿絵の参照画像は、ここか参照先ノートに `![[attachments/example.png]]` / `![説明](attachments/example.png)` で埋め込まれた vault 内画像だけが使われる)
- NSFW: false

## Outline

## Review Instructions

## Change History

## Run History
