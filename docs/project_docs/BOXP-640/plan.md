# BOXP-640: antigravity 担当で Neon を正確な識別子で指定し、実行証跡を残す

依頼元: BOXP-627 TD-04（ひとはこGBC のシナリオレビューを agy Neon で回す）。

## 方針

1. モデルの選び方（task_board_runner.bb `antigravity-model-choice`）
   - 票の frontmatter `antigravity-model: <slug>`（その票だけ） > 環境変数 `CODEX_TASK_BOARD_ANTIGRAVITY_MODEL`（全 run） > CLI 既定（`--model` なし）。
   - slug は `[A-Za-z0-9][A-Za-z0-9._-]{0,99}` だけ通す（別フラグへの注入を防ぐ）。通らない票の値は使わず `:model-request-invalid true` を記録。
   - summary の `:model-source` は `:ticket` / `:env` / `:cli-default`。
2. 識別子の確認（BOXP-630 CD-03 の範囲内）
   - 指定がある時だけ、runner 自身が公式バイナリの `agy models` を headless・同じ env（API 鍵等を除いたもの）で起動し、stdout を run dir の `agy-models.txt` に残す。
   - 一覧の1列目に指定 slug があれば `:antigravity {:model-listed true}`、無ければ false、一覧が取れなければ `:model-list-exit` / `"timeout"` / `"failed"`。
   - 一覧に無くても run は止めない（docs 上、未知の `--model` は既定に落ちず ERROR で失敗する）。
3. 実行証跡
   - events.jsonl の最初の `init` イベントの `init.model`（`--model` 指定時だけ入る）を `:antigravity :init-model` に記録。
   - `:model-confirmed` は「指定 slug == init.model かつ result SUCCESS」の時だけ true。CLI 既定の run は常に false。
4. 守る事
   - Claude/Codex/delegate.py から agy は呼ばない（この作業でも呼んでいない）。資格情報を読まない。API 鍵・ADC・AI Credits を使わない。
   - 指定のない antigravity run は従来どおり `--model` なし・`agy-default`/`:cli-default`。

## 確認

- `bb task_board_runner.bb test` に選択順・slug 拒否・`agy models` 解析（偽バイナリ）・init 解析・confirmed 判定のテストを追加。
- 配備後、BOXP-627 に `antigravity-model: gemini-4-neon-high` を付けて 1 run 回し、summary.edn の `:antigravity` と `agy-models.txt` で実在と使用を確かめる。
