# Novels

Novel Board の小説管理ノート置き場。本文の公開先ではない。

## 手動追加

`Boards/Novel Board.md` の `Backlog` にタイトルだけの未リンクカードを追加する。

```markdown
- [ ] タイトルだけ
- [ ] 成人向けタイトル #nsfw
- [ ] すぐ要件整理を依頼するタイトル assignee::pi
```

Novel Board runner の次の tick で、既存の `NOVEL-N` を確認して新しい ID を採番し、次の2つを一度だけ作成する。

- `Templates/Novel Management.md` から `Novels/NOVEL-N.md` を作成する。
- 元の行を `[[Novels/NOVEL-N|NOVEL-N: タイトル]] #novel status::backlog assignee::...` 形式へ置き換える。

`assignee::` を省略した場合は `boxp` となり、執筆 agent は起動しない。scaffold 後に要件整理を開始したい場合だけ、正式カードへ対応 agent を割り当てる。`#nsfw` は正式カードと管理ノートへ引き継がれる。

## レーン運用

- `Backlog`: 手動追加と要件整理の入口。対応 agent を割り当てると、本文を書かずに Requirements と Outline を整理する。完了後は `Draft` へ移る。
- `Draft`: 執筆開始前の人間確認。条件が不足する場合は人間が `Backlog` へ戻す。執筆開始時だけ対応 agent を割り当てる。
- `In Progress`: 初稿または改稿中。runner が同じ private `manuscript.md` を継続更新し、結果にかかわらず人間確認が必要な状態では `Review` へ戻す。
- `Review`: 原稿と履歴の人間確認。改稿する場合は `Review Instructions` に具体的な指示を保存して対応 agent を割り当てる。承認する場合だけ、人間がカードを `Done` へ移す。
- `Done`: agent は再実行しない。runner は承認済み private 原稿を、カード上の `#nsfw` に従って完成版フォルダへ冪等に配置する。

カードのレーンが状態の source of truth である。カードの `status::` や管理ノート frontmatter と不一致の場合、runner がレーンに合わせて同期する。過去の run state を理由にレーンを戻さない。

## 管理ノート

`Templates/Novel Management.md` を基準に、以下を保持する。

- `Requirements`: タイトル、あらすじ、登場人物、文体・視点、対象読者、目標文字数、必須要素、禁止事項、参照資料、NSFW 判定。
- `Outline`: 章立て、場面、展開。
- `Review Instructions`: 人間からの最新の具体的な改稿指示。指示が空のまま agent を割り当てても Review から再開しない。
- `Change History`: 原稿の変更履歴。
- `Run History`: runner の実行、停止理由、再開条件。

Pi に画像を渡す場合は、Requirements、Outline、Review Instructions のいずれかに vault 内画像を `![[Attachments/example.png]]` または `![説明](Attachments/example.png)` で埋め込む。vault 外、存在しない、曖昧な画像参照は agent へ渡さない。

## 原稿と完成版

作業中原稿、prompt、log、結果は `/home/boxp/.novel-board/` 配下に置き、SFW/NSFW とも完成前は非公開にする。管理ノートへ本文を埋め込まない。

人間が `Review` から `Done` へ移した後だけ、runner が次へ配置する。

- カードに正規タグ `#nsfw` がある: `NSFW/小説/AI執筆/`
- `#nsfw` がない: `小説草案/AI執筆/`

ファイル名は `YYYY-MM-DD-HH-mm_タイトル.md`。同名を上書きせず、同一カードを再走査しても重複生成しない。完成後は管理ノートの `published-path` と wiki link から完成版を辿れる。
