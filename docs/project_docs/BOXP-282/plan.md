# BOXP-282: localllm の vault 全域参照と新キャラ・新魔物設定ノート作成を実運用へ拡張

- チケット: vault `Tickets/BOXP-282`（BOXP-277 の後続。Owner 承認: 「vault 内は全部読み取り可能にしたい」「新たなキャラ設定と魔物の追加」）
- 設計・評価の正本: vault `Projects/task-board-localllm-docs/README.md`（owner 入口）、`evaluation.md` §9（本票の評価）、`evidence/`
- 実装: boxp/arch `docker/codex-workspace/task-board/localllm_docs.bb`（`docs-mode: create`、vault 全域 corpus、階層 index / list / リンク先表示、秘匿行の除去）+ `task_board_runner.bb`（Notes 文言）+ `tests/codex-workspace/localllm-docs-test.sh`（fake LLM black-box）+ `tests/codex-workspace/localllm-eval/`（`create_cases.edn`、`setting_fixture.bb --scale L` に魔物資料と大量ノイズを追加）
- 配備設定: boxp/lolice `argoproj/codex-workspace/deployment.yaml` の `task-board-runner` sidecar に `CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS=.` と `CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES=.` を追加（書込み root は変えない）

## 現行 revision の照合（2026-10-24 04:20 UTC）

| 項目 | 事実 |
| --- | --- |
| main | `3bf322cf1`。#13838（事実転記 adapter v4.3）/ #13842（`docs-mode: propose`）は merge 済み |
| 配備 | Pod `codex-workspace-58b4c57585-hl549`（image `sha-73f39be`、`73f39be` は #13842 の子孫）。runner 5 ファイルは main と同一系列 |
| 未配備 | PR #13845（ticket brief から runner 生成 Notes を除外。CI pass、review なし）→ 本 run で gate（codex review）を通してから先に merge し、本 PR はその上に積む |
| 実 vault | `.md` 2,121 件 / 18.5 MB、最大ノート 522 KB、symlink 0、非 Markdown 4,190 件（画像・clj 等）。現行の corpus 上限（1,000 ノート / 32 MB）を超えるため既定値の見直しが必要 |
| 設定資料の形 | `ひとはこさんバース/{キャラ設定,世界観設定,アイテム設定}`（本文は読まない。見出しの頻度だけ採取: 概要 / プロフィール / 外見 / 性格 / セリフ例 / 物語上の役割 / 関係 / 関連。魔物相当は「怪獣」としてキャラ設定と世界観設定に存在） |
| 実 API | `http://llama-server.local-llm.svc.cluster.local:8080/v1`、`gemma4-26b` loaded。この host から到達可 |

## 権限境界（runner が強制）

- **読取**: `CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS` に `.`（vault root）を許可。常に除外: 隠しディレクトリ（`.obsidian` / `.git` / `.trash` …）、`.md` 以外、symlink 経由、vault 外、絶対 path、`..`。既定で除外（`CODEX_TASK_BOARD_LOCALLLM_EXCLUDE_PATHS`）: `Tickets`、`Boards`、`Templates`、`Projects/task-board-localllm-docs/proposals`（自作の未承認案は canon として再利用しない）。frontmatter `localllm-proposal: true` のノートはどこにあっても corpus から除外。認証情報らしき行（AWS / GitHub / Slack / OpenAI / Google の鍵形式、PEM、JWT、`password:`/`token:` + 値）は corpus 読込時に runner が除去し、モデルにも Notes にも渡さない（件数だけ audit）。非 Markdown 添付（画像・PDF・clj）は読まない（未対応として README に明記）。
- **書込み**: `docs-mode: create` は `CODEX_TASK_BOARD_LOCALLLM_PROPOSAL_ROOT`（既定 `Projects/task-board-localllm-docs/proposals`）配下の `characters/` または `monsters/` に **新規ノートを 1 件** 作る。既存ノートの上書きは不可（path 衝突・同名・別名・slug 衝突は修正ラウンド 1 回 → それでも衝突なら Blocked）。Review 改稿は同じ提案ノートの本文（frontmatter 以外）を置換。既存の世界観フォルダへは書かない。transcribe / propose の既存境界は変更しない。
- **外部送信なし**: cloud agent / 外部 API / GitHub / 通知へ資料本文を送らない。Notes には出典 path・件数・調査量だけ。

## `docs-mode: create` の契約

- frontmatter: `assignee: localllm`、`docs-mode: create`、任意 `docs-kind: character|monster`、任意 `docs-sources`（省略時は既定 corpus = vault 全域）、任意 `docs-target`（省略時は runner が解決）。
- 種別の解決: `docs-kind` → 無ければ題名 + Summary のキーワード（魔物 / モンスター / 怪物 / 怪獣 / 魔獣 → monster、キャラ / 人物 / 登場人物 / ヒロイン → character）。両方 / どちらも無ければモデルを呼ばず Blocked（`docs-kind` を指定するよう質問）。
- 調査: v4 の段階的収集に `list`（フォルダ内一覧）を追加。index は一覧が予算に収まらない規模ではフォルダ木（件数・字数）になり、search は本文に加え path / タイトルにも一致、read は節末尾にそのノートの wikilink 先（corpus 内）を表示してリンク探索できる。既定 round 6 → 8。
- 出力 schema（strict）: `decision propose|needs-human`、`name`（日本語表記）、`slug`（ASCII kebab）、`aliases[]`、`summary`、種別別の節（キャラ: プロフィール / 外見 / 性格・口調（セリフ例）/ 物語上の役割 / 関係性 / 時系列、魔物: 生態 / 生息域 / 特徴・能力 / 世界観上の位置づけと既存種との関係 / 物語上の使い方 / 弱点）、`canon_facts[{fact, source}]`、`conflicts[]`、`questions[]`、`sources[]`。
- runner が描画: frontmatter（`title` / `type: character-proposal|monster-proposal` / `status: unapproved` / `localllm-proposal: true` / `ticket` / `created` / `run`）+ 未承認バナー + 各節 + 「参照した既存設定（出典 wikilink）」+「矛盾・要確認（自動検査含む）」+「人への質問」。全項目の埋め合わせは求めず、不明は「未定（要確認）」。既存の事実（年齢・関係性）は canon_facts として引用し変更しない。
- 衝突検査（runner、決定的）: 作成 path の存在、corpus / proposals 内のタイトル・ファイル名・`aliases` と `name` / `aliases` の一致 → 拒否。部分一致（2 文字以上の包含）は「名前が近い既存ノート（自動検査）」として矛盾・要確認に列挙。
- 改稿: Review 再実行時は proposals 配下で frontmatter `ticket: BOXP-N` を持つ自分のノートを探し、前回の案を別掲してモデルに渡し、本文を置換（`replace-body`）。frontmatter は不変。
- 終了: 常に Review（作成 / 置換済み、担当 boxp）か Blocked（未作成）。Done にしない。rollback は既存コマンド（新規作成ノートは削除、置換は backup から復元）。

## 検証

1. black-box（fake LLM、CI）: create の作成 / 改稿 / 種別解決 / 衝突 → 修正 → 成功 / 衝突継続 → Blocked / 曖昧種別 → 無請求 Blocked / vault 全域 root での除外（Tickets・隠し dir・他票の提案・`localllm-proposal: true`）/ 秘匿行の除去（モデルに届かない・Notes に出ない）/ 1,000 件超 corpus の階層 index と list / 命令注入ノートの無視 / 既存テスト全件。
2. 実 Gemma4 評価（CI 外、`run_eval.bb --cases-file create_cases.edn`）: 合成非露骨 fixture（灯火街 + 魔物 3 種 + 旧版 / 却下 / 未承認 / 同名囮 / 注入 / 秘匿 sentinel + 規模 L のノイズ）で、新キャラ作成 ×3 ケース・新魔物作成 ×3 ケース・改稿 ×2・衝突 ×1・曖昧種別 ×1、各 2 反復。判定は決定的 checker（canon byte 不変、新規ノートが 1 件だけ、禁止パターン無し、出典が読んだ資料のみ、注入文 / sentinel 不在）+ 目視。
3. 配備後 E2E（実 vault、配備済み loop runner の通常 tick）: テスト票を Ready に置き、Projects 配下の合成資料だけを `docs-sources` に宣言して新キャラ作成 → Review → Notes 指示で改稿 → 再 Review を Obsidian で確認。vault 全域 read root の有効化は env 配備後に、安全な sentinel ノートで scope を確認（実私的本文を cloud に棚卸ししない）。

## やらないこと

- 既存の世界観フォルダへの自動書込み、全 vault への書込み拡張、`.md` 以外の読取、外部 embedding / vector DB、cloud fallback、モデル / GPU / driver / `--parallel` の変更、他 agent run の停止や lock 削除、NSFW 本文生成品質の評価。

## 結果

（実装・評価・配備後に追記）

### 進捗（run 20261024T043310Z、再開後）

- 実装: `localllm_docs.bb` に vault 全域 read root（`.`）、隠し dir / 除外 path / `localllm-proposal` ノートの除外、秘匿行の除去、corpus 上限（5,000 / 64 MB）、フォルダ木 index、`list` action、search の path / タイトル一致、read のリンク先表示、`docs-mode: create`（種別解決、create-schema、キャラ / 魔物別の節、名前・別名・slug 衝突検査、proposals 配下への新規ノート描画、同票ノートの本文置換）、`run-docs-create!`。`task_board_runner.bb` の Review Notes に create 文言。
- 検証: black-box 60 本 pass（新規 5 本）。実 Gemma4 評価は `create_cases.edn`（9 ケース）を実行中。
- 配備設定: lolice worktree（`codex-task-board/BOXP-282-localllm-env`）に `READ_ROOTS=.` / `DEFAULT_SOURCES=.` を用意（arch merge 後に PR）。
- 文書: vault `Projects/task-board-localllm-docs/README.md` に BOXP-282 節、`evaluation.md` §9（結果は実行後に追記）。

### 結果（1 反復目）

- 実 Gemma4 評価 `create_cases.edn` 9/9（rescore 後。詳細は vault evaluation §9.2、証拠 `evidence/create-v1/`）。black-box 62 本 pass。codex review 7 回（P1 ×3、P2 ×4 を修正、最終回は指摘なし）。PR: https://github.com/boxp/arch/pull/13864
