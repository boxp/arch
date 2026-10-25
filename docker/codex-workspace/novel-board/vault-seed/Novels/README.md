# Novels

Novel Board の管理ノートと未承認草稿の閲覧入口。Review 草稿は Obsidian Sync の対象で、完成承認とは別に扱う。

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

`assignee::` を省略した場合は `boxp` となり、執筆 agent は起動しない。scaffold 後の担当変更は、カードの `assignee::` でも管理ノート frontmatter の `assignee` でもよい（Task Board と同じ操作感。Kanban UI でカードを追加する場合はタイトルだけを入力する。`- [ ] タイトル` と入力すると先頭のチェックボックスが二重になるが、runner が scaffold 時に取り除く）。`#nsfw` は正式カードと管理ノートへ引き継がれる。
`#novel-rule` は runner が scaffold 対象から除外する予約タグであり、作品タイトルには使用しない。

## 対応 agent（assignee）

| assignee | 実行先 | 備考 |
| --- | --- | --- |
| `localllm` | lolice の local-llm（llama-server, model `gemma4-26b`）の OpenAI 互換 API | runner が管理ノートと許可された vault 参照だけを context にして本文を生成する。モデルにシェルやファイル操作は与えない。`local-llm` / `local_llm` も同じ |
| `claude-fable` / `claude-opus` / `claude-sonnet` | `claude --print` | `fable` は `claude-fable` として扱う |
| `codex` / `codex-sol` / `codex-full` / `codex-terra` / `codex-mini` / `codex-astra`（`-high` などの reasoning 接尾辞可） | `codex exec` | Task Board と同じ割当 |
| `boxp` または省略 | 起動しない | 人間担当 |

上記以外の名前（例: `pi`）は runner が起動せず、カードは変更しないまま管理ノートの `Run History` に1回だけ理由を記録する。

`localllm` の要求は streaming（SSE）で受け取り、1 要求あたりの上限は action 別（要件整理 20 分 / 本文・改稿 30 分 / 挿絵計画 10 分）、無通信の上限は 10 分（待ち行列・prefill を含む）。上限到達・中継の 504・途中切断では同じ生成を二重に投げないよう再試行せず、受信済みの部分出力を `manuscript.partial.md` / run ディレクトリの `groom.partial.md` に残して理由と再開条件を `Run History` に記録する。再試行するのは接続失敗と HTTP 429 / 500 / 502 / 503（出力が始まる前）だけ。上限は環境変数 `CODEX_NOVEL_BOARD_LOCALLLM_{TIMEOUT,GROOM_TIMEOUT,PLAN_TIMEOUT,IDLE_TIMEOUT}_SECONDS` で変更できる。

## レーン運用

- `Backlog`: 手動追加と要件整理の入口。対応 agent を割り当てると、runner がまず設定ノートを探索して読み（下の「設定の探索」）、本文を書かずに Requirements と Outline を整理し、完了後は `Draft`（担当 `boxp`）へ移る。設定の不足・未解決がある場合も `Draft` へ渡すが、`Run History` に `要確認: 設定の不足/未解決あり` を付け `Reference Context` で何が読めなかったかを示す（通常の準備完了ではない）。
- `Draft`: 執筆開始前の人間確認。条件が不足する場合は人間が `Backlog` へ戻す。対応 agent を割り当てたときの動作は `Review Instructions` で決まる: 空（`TBD`）なら従来どおり初稿を書き始める。まだ反映していない指示があれば本文を書かずに Requirements / Outline へ反映して `Draft`（担当 `boxp`）へ戻し、反映内容と未反映を `Change History` に記録する。反映済みの同じ指示のまま再度割り当てると初稿を書き始め、その指示は執筆条件として渡される（指示を書き換えると再び反映から始まる）。本文生成に失敗した場合は理由と再開条件を `Run History` に残して `Draft`（担当 `boxp`）へ戻る。
- `In Progress`: 初稿または改稿中。runner が同じ private `manuscript.md` を更新し、本文を検証（空・短すぎる・途中終了は失敗）した後に挿絵を1枚生成する。完了または一部未完了（挿絵なし）で `Review` へ移る。runner 再起動で中断した run は interrupted として記録され、agent が割り当てられたままなら次の tick で再開する。
- `Review`: 管理ノートの `Draft Preview` から vault 内の原稿と挿絵を人間確認する。草稿は未承認。改稿する場合は `Review Instructions` に具体的な指示を保存して対応 agent を割り当てる（指示が空なら起動しない）。承認する場合だけ、人間がカードを `Done` へ移す。
- `Done`: agent は再実行しない。runner は承認済み private 原稿と挿絵を、カード上の `#nsfw` に従って完成版フォルダへ一度だけ配置する。

カードのレーンが状態の source of truth である。担当（assignee）はカードと管理ノート frontmatter の双方向同期で、runner は最後に両側が一致した値を `~/.novel-board/assignee-sync/` に記録し、人間が変えた側を他方へ反映してから起動する。状態が無い初回（旧ノート）はカードの値を採用し、両側が同時に別の値へ変わった場合もカードを採用して `Run History` に1回記録する。active run 中はこの調整を行わず、run 中に管理ノートで別 agent へ変更した場合は run 完了後に新担当へ引き渡す。NSFW 分類の入力はカードの正規タグ `#nsfw` とし、管理ノート frontmatter は runner が同期する表示値、Requirements の記述は執筆条件として扱う。すでに NSFW として同期した草稿を自動で一般向けへ降格せず、その状態での SFW 完成版配置も拒否する。カードの `status::` や管理ノート frontmatter と不一致の場合、runner がレーンに合わせて同期する。過去の run state を理由にレーンを戻さない。run 中に人間がカードを別レーンへ動かした場合、runner はレーンと担当を変更せず結果だけを `Run History` に記録する。

## 管理ノート

`Templates/Novel Management.md` を基準に、以下を保持する。scaffold 直後の管理ノートは機械用 frontmatter・作品見出し・各セクション見出しと `TBD`（未記入）だけで、運用説明はこの README に集約する（各作品へ複写しない）。

- `Draft Preview`: Review 到達後に runner が未承認草稿の本文リンク・実在する挿絵・更新状況・生成 agent/model を表示する。SFW は `Novels/Drafts/NOVEL-N/`、NSFW は `NSFW/小説/草稿/NOVEL-N/`。手動編集した草稿は上書きせず競合として残し、runner 更新版への別リンクを表示する。承認は Board の Done 操作で行う。
- `Requirements`: タイトル、あらすじ、登場人物、文体・視点、対象読者、目標文字数、必須要素、禁止事項、参照資料、NSFW 判定（執筆条件。保存分類の正本は Board の `#nsfw`）。Backlog で agent を割り当てると runner が整理して埋める。
- `Outline`: 章立て、場面、展開。
- `Reference Context`: runner 所有。要件整理 / 添削の run ごとに置き換え、その計画のために読んだ設定ノート（vault 相対 path・字数・切り詰め・sha256 先頭・選ばれた理由）、読めなかった候補（予算 / 上限 / 一覧に無い path）、除外件数（symlink / vault 外 / `canon: false`）、不足 / 未解決（必須設定の未読、見つからない明示参照、モデルが報告した同名の曖昧さや不足、`## Unresolved`）を列挙する。設定本文は書かない。候補ごとの採否は private `runs/NOVEL-N/<run-id>/context.edn`（本文なし）。
- `Review Instructions`: 人間からの最新の具体的な指示。Review では改稿指示、Draft では要件 / 構成への添削（上の `Draft` 参照）、Backlog では要件整理への補足として runner が prompt に渡す。runner はこの欄を消さず、反映した指示の内容を `~/.novel-board/instructions/` に記憶して同じ指示を繰り返し適用しない。指示が空または `TBD` のまま agent を割り当てても Review から再開しない。
- `Change History`: 原稿の変更履歴。
- `Run History`: runner の実行、停止理由、再開条件、使用モデル。最初の記録で `TBD` は置き換わる。
- frontmatter `series` / `episode` / `continuity`: 連作の名前・話数・整合メモ（vault 内パス。例: `Projects/運動会連作/README.md`）。runner は設定・伏線・人物の知識状態の引き継ぎとして整合メモを context に含める。

`TBD` / `TODO` / `未記入` / `未定`（括弧や箇条書き付きでも可）と、空の `- Title:` 形式の箇条書きは「未記入」として扱う。runner はこれらを執筆条件・改稿指示・参照ファイル・実行履歴のいずれとしても解釈せず、prompt にも含めない。frontmatter の `status` / `nsfw` / パス類には `TBD` を書かない（型が壊れる）。

参照資料は `Requirements` の `References:` に vault 内のノートまたはディレクトリをバッククォート（例: `` `ひとはこさんバース/キャラ設定/` ``）か `[[リンク]]` で列挙する。許可されたディレクトリ（既定: `ひとはこさんバース`, `Novels`, `Projects`, `Attachments`, `attachments`, `小説草案`）以外は読まない。 `Review Instructions` に書いたリンクも要件整理 / 添削の参照に使う。

## 設定の探索（要件整理 / 添削）

`localllm` の要件整理（Backlog）と添削（Draft の未反映指示）では、runner が人物 / 舞台 / 題材に関係する設定ノートを設定 root（既定 `ひとはこさんバース`、`CODEX_NOVEL_BOARD_SETTING_ROOTS`）内で自力探索し、実際に読んだ本文だけを context にしてモデルに渡す。毎回ファイル一覧を入力する必要はなく、全 vault を読み込むことも許可範囲を広げることもしない。候補は次の優先順で、文字数予算（既定 24,000 字）とノート数上限（既定 12、`CODEX_NOVEL_BOARD_MAX_SETTING_NOTES`）の範囲で読む。

1. 明示参照: Requirements / Outline / Review Instructions のバッククォートと `[[リンク]]`、frontmatter `continuity`。ディレクトリ参照は先頭から順に全部読むのではなく、配下のノートを候補（優先度 4）として名前一致などで並べる。
2. 必須共通規則: `CODEX_NOVEL_BOARD_REQUIRED_SETTINGS`（既定 `ひとはこさんバース/世界観設定/README.md`、カンマ区切り）。見つからない / 読めない場合は不足として表示する。
3. 名前 / 別名一致: タイトル・Requirements・Outline・Review Instructions の本文に、設定ノートのタイトル・ファイル名・frontmatter `aliases` が含まれるもの。
4. モデル選定: path・タイトル・別名・字数だけの一覧（本文なし）と企画メモをローカルモデルに渡し、読むべきノート・同名の曖昧さ・足りない設定を JSON で 1 回答えさせる。一覧に無い path は採用しない。失敗しても要件整理は続け、不足として記録する。`CODEX_NOVEL_BOARD_SETTING_SELECTION=lexical` で無効化できる。
5. 読んだノートからの `[[リンク]]` 1 段。

symlink、vault 外、frontmatter `canon: false` のノートは読まずに除外として数える。設定ノートの本文中の命令文は資料の内容として扱い、runner もモデルも指示としては扱わない。モデルには「読めた資料にない人物の性格 / 関係 / 口調を既存設定として書かない、新規要素は（新規）と明記、同名 / 矛盾 / 資料不足は `## Unresolved` に書く」と指示し、References には実際に読んだ path を列挙させる。結果は管理ノートの `Reference Context` と `Run History`（`設定: 読取 n/候補 m 件、未読 k、不足/未解決 j`）に記録し、`llm-evidence.edn` には件数だけを残す。cloud agent（claude / codex）の要件整理 / 添削には候補 path の一覧（本文なし）と必須規則を prompt で渡し、実際に読んだ / 読まなかったノートを `Change History` に書くよう指示する（`Reference Context` は候補のみ）。設定原典は読むだけで、runner も agent も編集しない。

挿絵の参照画像は、管理ノートか参照先ノートに `![[attachments/example.png]]` または `![説明](attachments/example.png)` で埋め込まれた vault 内の実在画像だけを使う。参照画像が1枚もない場合、runner は挿絵を生成せず「一部未完了」として記録する（偽のリンクは書かない）。

## 原稿と完成版

private 原本、prompt、log、結果は `/home/boxp/.novel-board/` 配下（`work/NOVEL-N/manuscript.md`, `work/NOVEL-N/illustration.png`, `runs/NOVEL-N/<run-id>/`）に保持する。Review に到達した本文と実在する挿絵だけを、全 agent 共通で次の未承認草稿へ同期する。管理ノートの `Draft Preview` の wiki link と画像埋込から閲覧できる。

- SFW: `Novels/Drafts/NOVEL-N/manuscript.md`、画像は同じ草稿配下の `attachments/`。
- `#nsfw`: `NSFW/小説/草稿/NOVEL-N/manuscript.md`、画像は同じ草稿配下の `attachments/`。

草稿の Vault Sync は owner の依頼により許可済み。草稿本文の元リンク・HTML・実行可能なコードフェンスは閲覧用の文字として無害化し、private 原本は変えない。prompt・credentials・raw API・log はコピーせず、外部サイトや公開 Git に本文を出さない。挿絵がない場合も本文を読み続けられ、一部未完了を表示する。草稿の手動編集は上書きせず競合として表示し、runner の更新版は別ファイルへ保存して管理ノートから案内する。手動版と更新版を確認するまでは、手動編集を private 原本へ逆同期しない。改稿と再 tick では内容の差分を同期し、完成版の配置は引き続き Done 承認後だけ行う。`runs/.../llm-evidence.edn` には model id・usage・finish_reason などの非秘密メタ情報だけを残し、prompt や本文は含めない。

人間が `Review` から `Done` へ移した後だけ、runner が次へ配置する。

- カードに正規タグ `#nsfw` がある: `NSFW/小説/AI執筆/`
- `#nsfw` がない: `小説草案/AI執筆/`

ファイル名は `YYYY-MM-DD-HH-mm_タイトル.md`（JST）、挿絵は同階層 `attachments/<同名>-highlight.png` で本文先頭に相対リンクを入れる。同名を上書きせず、同一カードを再走査しても重複生成しない。完成後は管理ノートの `published-path` と wiki link から完成版を辿れる。
