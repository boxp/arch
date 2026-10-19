# Novels

Novel Board の小説管理ノート置き場。本文の公開先ではない。

## 手動追加

`Boards/Novel Board.md` の `Backlog` にタイトルだけの未リンクカードを追加する。
各レーンにある `#novel-rule` カードは常設の運用説明であり、移動・削除・作品カードへの書き換えをしない。

```markdown
- [ ] タイトルだけ
- [ ] 成人向けタイトル #nsfw
- [ ] すぐ要件整理を依頼するタイトル assignee::localllm
```

Novel Board runner の次の tick で、既存の `NOVEL-N` を確認して新しい ID を採番し、次の2つを一度だけ作成する。

- `Templates/Novel Management.md` から `Novels/NOVEL-N.md` を作成する。
- 元の行を `[[Novels/NOVEL-N|NOVEL-N: タイトル]] #novel status::backlog assignee::...` 形式へ置き換える。

`assignee::` を省略した場合は `boxp` となり、執筆 agent は起動しない。`#nsfw` は正式カードと管理ノートへ引き継がれる。
`#novel-rule` は runner が scaffold 対象から除外する予約タグであり、作品タイトルには使用しない。

## 対応 agent（assignee）

| assignee | 実行先 | 備考 |
| --- | --- | --- |
| `localllm` | lolice の local-llm（llama-server, model `gemma4-26b`）の OpenAI 互換 API | runner が管理ノートと許可された vault 参照だけを context にして本文を生成する。モデルにシェルやファイル操作は与えない。`local-llm` / `local_llm` も同じ |
| `claude-fable` / `claude-opus` / `claude-sonnet` | `claude --print` | `fable` は `claude-fable` として扱う |
| `codex` / `codex-sol` / `codex-full` / `codex-terra` / `codex-mini` / `codex-astra`（`-high` などの reasoning 接尾辞可） | `codex exec` | Task Board と同じ割当 |
| `boxp` または省略 | 起動しない | 人間担当 |

上記以外の名前（例: `pi`）は runner が起動せず、カードは変更しないまま管理ノートの `Run History` に1回だけ理由を記録する。

## レーン運用

- `Backlog`: 手動追加と要件整理の入口。対応 agent を割り当てると、本文を書かずに Requirements と Outline を整理し、完了後は `Draft`（担当 `boxp`）へ移る。
- `Draft`: 執筆開始前の人間確認。条件が不足する場合は人間が `Backlog` へ戻す。執筆開始時だけ対応 agent を割り当てる。本文生成に失敗した場合は理由と再開条件を `Run History` に残して `Draft`（担当 `boxp`）へ戻る。
- `In Progress`: 初稿または改稿中。runner が同じ private `manuscript.md` を更新し、本文を検証（空・短すぎる・途中終了は失敗）した後に挿絵を1枚生成する。完了または一部未完了（挿絵なし）で `Review` へ移る。runner 再起動で中断した run は interrupted として記録され、agent が割り当てられたままなら次の tick で再開する。
- `Review`: 原稿と挿絵の人間確認。改稿する場合は `Review Instructions` に具体的な指示を保存して対応 agent を割り当てる（指示が空なら起動しない）。承認する場合だけ、人間がカードを `Done` へ移す。
- `Done`: agent は再実行しない。runner は承認済み private 原稿と挿絵を、カード上の `#nsfw` に従って完成版フォルダへ一度だけ配置する。

カードのレーンが状態の source of truth である。カードの `status::` や管理ノート frontmatter と不一致の場合、runner がレーンに合わせて同期する。過去の run state を理由にレーンを戻さない。run 中に人間がカードを別レーンへ動かした場合、runner はレーンと担当を変更せず結果だけを `Run History` に記録する。

## 管理ノート

`Templates/Novel Management.md` を基準に、以下を保持する。

- `Requirements`: タイトル、あらすじ、登場人物、文体・視点、対象読者、目標文字数、必須要素、禁止事項、参照資料、NSFW 判定。
- `Outline`: 章立て、場面、展開。
- `Review Instructions`: 人間からの最新の具体的な改稿指示。指示が空のまま agent を割り当てても Review から再開しない。
- `Change History`: 原稿の変更履歴。
- `Run History`: runner の実行、停止理由、再開条件、使用モデル。
- frontmatter `series` / `episode` / `continuity`: 連作の名前・話数・整合メモ（vault 内パス）。runner は整合メモを context に含める。

参照資料は `Requirements` の `References:` に vault 内のノートまたはディレクトリをバッククォート（例: `` `ひとはこさんバース/キャラ設定/` ``）か `[[リンク]]` で列挙する。許可されたディレクトリ（既定: `ひとはこさんバース`, `Novels`, `Projects`, `Attachments`, `attachments`, `小説草案`）以外は読まない。

挿絵の参照画像は、管理ノートか参照先ノートに `![[attachments/example.png]]` または `![説明](attachments/example.png)` で埋め込まれた vault 内の実在画像だけを使う。参照画像が1枚もない場合、runner は挿絵を生成せず「一部未完了」として記録する（偽のリンクは書かない）。

## 原稿と完成版

作業中原稿、prompt、log、結果、挿絵は `/home/boxp/.novel-board/` 配下（`work/NOVEL-N/manuscript.md`, `work/NOVEL-N/illustration.png`, `runs/NOVEL-N/<run-id>/`）に 0600/0700 で置き、SFW/NSFW とも完成前は非公開にする。管理ノートへ本文を埋め込まない。`runs/.../llm-evidence.edn` には model id・usage・finish_reason などの非秘密メタ情報だけを残し、prompt や本文は含めない。

人間が `Review` から `Done` へ移した後だけ、runner が次へ配置する。

- カードに正規タグ `#nsfw` がある: `NSFW/小説/AI執筆/`
- `#nsfw` がない: `小説草案/AI執筆/`

ファイル名は `YYYY-MM-DD-HH-mm_タイトル.md`（JST）、挿絵は同階層 `attachments/<同名>-highlight.png` で本文先頭に相対リンクを入れる。同名を上書きせず、同一カードを再走査しても重複生成しない。完成後は管理ノートの `published-path` と wiki link から完成版を辿れる。
