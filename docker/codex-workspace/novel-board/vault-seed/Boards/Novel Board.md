---

kanban-plugin: board

---

## Novel Board

- [ ] 小説の管理ノートは `Novels/NOVEL-N.md` に1作品1ノートで作る。
- [ ] カードは `[[Novels/NOVEL-N|NOVEL-N: タイトル]] #novel status::backlog assignee::boxp` の形式にする。
- [ ] 手動追加は `Backlog` にタイトルだけのカードを追加する（生ファイル編集なら `- [ ] タイトル`、Kanban UI ならタイトルのみ入力）。runner が次の tick で ID を採番し、正式カードと管理ノートを scaffold する。
- [ ] `#nsfw` や `assignee::agent名` はタイトルカードにも任意指定できる。省略時の担当は `boxp` で、agent を明示するまで執筆しない。
- [ ] 対応 agent は `localllm`（lolice の local-llm / Gemma 4 で本文生成）、`claude-fable` / `claude-opus` / `claude-sonnet`、`codex` 系。未対応の名前はカードを変更せず Run History に1回だけ記録する。
- [ ] 管理ノートのテンプレートは `Templates/Novel Management.md` を使う。
- [ ] 状態はカードのレーンを SSOT とし、管理ノートの `status` / `nsfw` は runner がカードに合わせて同期する。担当は Task Board と同様にカードの `assignee::` と管理ノート frontmatter の `assignee` のどちらを変えてもよく、runner が人間の変えた側を他方へ揃えてから起動する（同時に別の値なら カードを採用し Run History に記録）。runner 自身がカードの担当を書き換えるのは、人間の変更の反映と、自分の run を終えて人間確認レーンへ渡す時（`assignee::boxp`）だけ。
- [ ] `Draft` と `Review` は人間確認レーン。`Review` からの改稿は指示を管理ノートへ書いて agent を割り当て、承認時だけ人間が `Done` へ移す。`Draft` で管理ノートの `Review Instructions` に要件 / 構成への指示を書いて agent を割り当てると、本文を書かずに Requirements / Outline へ反映して `Draft` に戻る。
- [ ] 原本は private work dir に保持し、Review 到達後は管理ノートの Draft Preview から未承認の vault 草稿と挿絵を読む。完成版配置は Done 承認後だけ。詳細は `Novels/README.md` を参照する。


## Backlog

- [ ] **運用ルール:** タイトルだけの新規カードを受け付ける。agent 割当時は本文を書かず Requirements と Outline を整理し、完了後に `Draft`（担当 boxp）へ移す。 #novel-rule


## Draft

- [ ] **運用ルール:** 執筆開始前の人間確認レーン。条件不足なら人間が `Backlog` へ戻す。agent を割り当てると、`Review Instructions` が空なら初稿を書き始め、未反映の指示があれば本文を書かずに Requirements / Outline へ反映して `Draft`（担当 boxp）へ戻る（同じ指示のまま再割当で初稿開始）。本文生成に失敗した場合は理由と再開条件を Run History に残して `Draft`（担当 boxp）へ戻る。 #novel-rule


## In Progress

- [ ] **運用ルール:** 同じ private 原稿で初稿または改稿を進め、本文の検証後に runner が挿絵を1枚生成する。完了・一部未完了（挿絵なし）のいずれも理由を記録して `Review` へ移す。 #novel-rule


## Review

- [ ] **運用ルール:** 管理ノートの Draft Preview から未承認草稿の本文・挿絵を確認する。改稿は管理ノートの `Review Instructions` と agent 割当で再開し（指示が空なら起動しない）、承認時だけ人間が `Done` へ移す。 #novel-rule


## Done

- [ ] **運用ルール:** agent は再実行しない。承認済み原稿と挿絵をカードの `#nsfw` に従って一度だけ完成版フォルダへ配置する（同名は上書きしない）。 #novel-rule




%% kanban:settings
```
{"kanban-plugin":"board","show-checkboxes":false}
```
%%
