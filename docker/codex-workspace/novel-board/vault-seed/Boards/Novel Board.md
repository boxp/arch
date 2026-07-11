---

kanban-plugin: board

---

# Novel Board

- [ ] 小説の管理ノートは `Novels/NOVEL-N.md` に1作品1ノートで作る。
- [ ] カードは `[[Novels/NOVEL-N|NOVEL-N: タイトル]] #novel status::backlog assignee::boxp` の形式にする。
- [ ] 手動追加は `Backlog` に `- [ ] タイトル` とだけ入力する。runner が次の tick で ID を採番し、正式カードと管理ノートを scaffold する。
- [ ] `#nsfw` や `assignee::agent名` はタイトルカードにも任意指定できる。省略時の担当は `boxp` で、agent を明示するまで執筆しない。
- [ ] 管理ノートのテンプレートは `Templates/Novel Management.md` を使う。
- [ ] 状態はカードのレーンを SSOT とし、管理ノートの `status` とカードの `status::` は runner が同期する。
- [ ] `Draft` と `Review` は人間確認レーン。`Review` からの改稿は指示を管理ノートへ書いて agent を割り当て、承認時だけ人間が `Done` へ移す。
- [ ] `Done` 前の原稿は private work dir に置き、完成版フォルダへ直接配置しない。詳細は `Novels/README.md` を参照する。

## Backlog

- [ ] **運用ルール:** タイトルだけの新規カードを受け付ける。agent 割当時は本文を書かず Requirements と Outline を整理し、完了後に `Draft` へ移す。 #novel-rule

## Draft

- [ ] **運用ルール:** 執筆開始前の人間確認レーン。条件不足なら人間が `Backlog` へ戻し、執筆を始める場合だけ対応 agent を割り当てる。 #novel-rule

## In Progress

- [ ] **運用ルール:** 同じ private 原稿で初稿または改稿を進める。レビュー可能、失敗、要件不足、判断待ちのいずれも理由を記録して `Review` へ移す。 #novel-rule

## Review

- [ ] **運用ルール:** 人間確認レーン。改稿は管理ノートの `Review Instructions` と agent 割当で再開し、承認時だけ人間が `Done` へ移す。 #novel-rule

## Done

- [ ] **運用ルール:** agent は再実行しない。承認済み原稿をカードの `#nsfw` に従って一度だけ完成版フォルダへ配置する。 #novel-rule

%% kanban:settings
```
{"kanban-plugin":"board","show-checkboxes":false}
```
%%
