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

## Draft

## In Progress

## Review

## Done

%% kanban:settings
```
{"kanban-plugin":"board","show-checkboxes":false}
```
%%
