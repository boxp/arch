---
id:
type: novel
status: backlog
title:
assignee: boxp
nsfw: false
work-dir:
manuscript:
published-path:
published-at:
---

# Novel

このノートは `Boards/Novel Board.md` のカードと1対1で管理する。状態変更は Board のレーンを先に移動し、runner に `status` を同期させる。初稿・改稿本文はこのノートへ貼らず、`manuscript` の private file を使う。

## Workflow

- `Backlog`: 本文を書かず、Requirements と Outline を整理する。
- `Draft`: 執筆条件を人間が確認する。執筆開始時だけ Board のカードへ対応 agent を割り当てる。
- `In Progress`: 同じ private 原稿で初稿または改稿を進める。
- `Review`: 人間が原稿を確認する。改稿時は `Review Instructions` を記録して agent を割り当て、承認時だけ人間がカードを `Done` へ移す。
- `Done`: agent は再実行せず、runner が承認済み原稿をカードの `#nsfw` に従って一度だけ完成版へ配置する。

カードのレーンが source of truth であり、このノートの `status` を直接変えても遷移しない。停止理由と再開条件は `Run History`、改稿指示は `Review Instructions`、原稿の変更内容は `Change History` に残す。

## Requirements

- Title:
- Synopsis:
- Characters:
- Style and point of view:
- Target readers:
- Target length:
- Required elements:
- Prohibited elements:
- References: (Pi image input: embed a vault-local PNG/JPEG/GIF/WebP as `![[Attachments/example.png]]` or `![alt](Attachments/example.png)`)
- NSFW: false

## Outline

## Review Instructions

## Change History

## Run History
