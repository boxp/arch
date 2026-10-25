# BOXP-294: 指定 Qwen3.8-27B GGUF を通常 localllm の選べる model として追加し Gemma4 と比較

- チケット: vault `Tickets/BOXP-294`（Owner 依頼 + 是正「localllm の model に追加してるわけじゃないんですか？」）。
- 非公開の正本: vault `Projects/local-llm-qwen38-vs-gemma4/README.md`（実機条件・結果表・推奨・rollback）。本 plan と PR には原典・生成本文・要約を載せない（path と件数のみ）。
- 姉妹 PR: `boxp/lolice` `argoproj/local-llm/models-config.yaml` に `[qwen38-27b]` preset を追加（既存 3 preset・既定・Deployment 引数は不変）。

## 現状（2026-10-24 調査）

| 項目 | 現行 | 本票 |
| --- | --- | --- |
| model 登録 | lolice `models.ini`（llama-server router、`--models-max 1`、要求された id を on-demand load・他を unload） | `[qwen38-27b]` を追加。既定 `gemma4-26b` は不変 |
| runner の model | `CODEX_TASK_BOARD_LOCALLLM_MODEL`（配備で 1 つ）だけ。票ごとの選択は無い。Notes の `model=` は常に `localllm` 固定だった | 票 frontmatter `docs-model: <id>`。未指定は既定。指定 id は router の `GET /v1/models` と照合し、無い id / 許可外 id / 不正な id はモデル呼出なしで `Blocked`（既定へ黙って fallback しない） |
| 証拠 | `llm-evidence.edn` にサーバーが返した model | 加えて run 結果・audit・Notes `model=` に選択 id を記録 |

## 変更（boxp/arch）

- `docker/codex-workspace/task-board/localllm_docs.bb`
  - `*ticket-model*`（dynamic）と `config` の `:model` / `:models`（任意 allowlist env `CODEX_TASK_BOARD_LOCALLLM_MODELS`）。
  - `docs-model-declared` / `served-model-ids` / `resolve-docs-model`。`run-docs-edit!` が最初に解決し、run 全体を `binding` で包む（request・audit・evidence が同じ id を持つ）。
  - run 結果（edit* / create / finish-without-model）に `:model` を載せ、runner の Review Notes `model=` が実 id になる。
- `tests/codex-workspace/localllm-docs-test.sh`: fake server に `GET /v1/models` と要求 model の echo を追加。`docs-model` の採用 / 未登録 id / 許可外 id・不正 id の 3 テスト。
- `docker/hermes-agent/skills/obsidian-task-board/SKILL.md`: `docs-model` の説明と依頼例。

## 境界（変えないもの）

- 既定モデル・既存 preset・Deployment 引数・読取 / 書込 root・cloud 非 fallback・排他 / rollback は既存のまま。
- 比較用 static pod / env 差替えは本番経路ではない。通常 Board からの実 E2E（`docs-model: qwen38-27b` の票で groom → create → Review 改稿）で完了を判定する。

## 検証

- `tests/codex-workspace/localllm-docs-test.sh` 全件（CI `test-codex-task-board-runner.yml`）。
- 本番 ini 反映前に golyat-4 の static pod を live と同一 image・router mode・候補 `models.ini` で起動し、`/v1/models` → load → 日本語応答 → 応答 `model` id を確認。
- 配備後: 通常 Board の票（`assignee: localllm` + `docs-model: qwen38-27b`）で groom / create / Review 改稿を実行し、Notes `model=` / audit / evidence の served model と `GET /models` の loaded 状態で実使用を確認。終了後 `gemma4-26b` の再ロードと `/health` を確認（rollback）。

## 配備後 E2E（2026-10-25、票 BOXP-295）と追補

- groom（モデル呼出なし）→ create は要求どおり router が `qwen38-27b` を on-demand load（Gemma 4 を unload）し、Notes `model=` / audit `:model` / evidence の served model がすべて `qwen38-27b`、提案ノート 1 件のみ新規、原典書込なし。Review で指示なしの再実行はモデル呼出なしで Blocked。
- 異常 1 件: 改稿指示後に Blocked から再実行した run（00:47 UTC）が、票ファイルに `docs-model: qwen38-27b` が残っているにもかかわらず既定 `gemma4-26b` で動いた（router log で要求 model を確認、audit `:model gemma4-26b`）。同じ手順を CI の fake server（tick / loop どちらも）で再現すると毎回 `qwen38-27b` を要求し、再現せず。改稿結果は run backup から rollback し、再実行では `qwen38-27b` が要求された。
- 追補（この PR）: `run-docs-edit!` が model 解決を runner log に残し、caller の frontmatter map に `docs-model` が無いときは票本文の frontmatter を読み直す。提案ノート改稿の再実行は、ノートを生成した run の audit `:model` と今回の model が違い、かつ今回が明示指定でない（`:model-resolution :default`）ならモデルを呼ばず `Blocked`（category `localllm-model-mismatch`）。明示的に別 id を `docs-model` に書いた場合は従来どおり実行。audit に `:model-resolution` を追加。テスト `test_revision_keeps_the_notes_model_or_blocks`。
