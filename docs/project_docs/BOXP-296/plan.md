# BOXP-296: localllm が自然文から編集対象・新規保存先を選び実バースの通常フォルダへ反映する

- チケット: BOXP-296（Obsidian vault `Tickets/BOXP-296.md`）
- 担当: claude-fable（Task Board runner）
- 対象: `docker/codex-workspace/task-board/localllm_docs.bb` / `task_board_runner.bb` / `tests/codex-workspace/localllm-docs-test.sh`、lolice `argoproj/codex-workspace/deployment.yaml`（env 1 件）、vault `Projects/task-board-localllm-docs/README.md`
- 土台: boxp/arch#13952（BOXP-294 堅牢化、未 merge）を本 branch に merge して重ねる（`run-docs-edit!` 周辺の textual 競合を避ける）

## 背景（現行との差分）

- 現行（BOXP-290）: `assignee: localllm` + 自然文で Backlog groom → Ready + boxp → 実行 → Review → Notes 指示で改稿。groom は **語句規則だけ**（モデル呼出なし）。加筆（propose）は wikilink 1 件が **書込許可 root（pilot / proposals）内** のときだけ。新規作成（create）は `Projects/task-board-localllm-docs/proposals/` 配下。原典 `ひとはこさんバース/` は read-only。
- Owner 最新要件: 「指定したノートを編集するのではなく、指示に従ってファイルを選択するようにしたい」「追加 / 編集先は『ひとはこさんバースのいつものフォルダ』」。パス・docs-target・wikilink の列挙を Owner 必須にしない。
- 実バースの構造（名前のみ確認、本文は cloud に渡さない）: `ひとはこさんバース/キャラ設定/`（15 md + `モブ/` 2 md）、`世界観設定/`（7 md）、`アイテム設定/`（4 md）。`attachments/` は非 md（対象外）。

## 設計

### 1. 書込 root の追加（env、確認済み計画がある時だけ有効）

- 新 env `CODEX_TASK_BOARD_LOCALLLM_CANON_ROOTS`（vault 相対フォルダ、カンマ区切り。既定は空 = 機能オフ）。lolice で `ひとはこさんバース`。
- `DOCS_ROOTS`（pilot）/ `PROPOSAL_ROOT` / `READ_ROOTS` / `EXCLUDE_PATHS` は不変。canon root は **groom が固定した計画（`docs-plan`）を持つ票の amend / create 実行だけ** が書込許可に加える（`cfg :docs-roots` を run 内で拡張、audit `:docs-roots` に記録 → rollback / crash recovery も同じ root で動く）。
- 常に対象外: `.md` 以外（attachments）、隠し、symlink、vault 外、`..`、絶対 path、Tickets / Boards / Templates、他 Projects / Novels / NSFW 等（canon root 外）。削除 / rename / 一括移動 / frontmatter 変更の op は存在しない。

### 2. groom の拡張: 内容探索で対象 / 新規保存先を選ぶ（`select`）

- `resolve-docs-mode` に `:select` を追加: canon root が設定されていて、frontmatter に docs-mode / docs-target が無く、票の自作ノートも無く、題名 / Summary が自然文だけのとき。従来の規則（明示 frontmatter 優先、wikilink 1 件が pilot 内なら propose、canon 書き換え依頼は質問）は維持。
- Backlog groom（`groom-ticket`）が `:select` なら、`resolve-docs-model`（docs-model 互換、Gemma4 既定 / Qwen 選択）→ `run-research!`（既定 corpus = ひとはこさんバース、index → list / search / read、既存の round / 文字 / 時間予算）→ **選定呼出 1 回**（JSON schema `docs_target_selection`）:
  - `decision: target` … 既存ノートへの追記 / 編集。`targets: [{path, section, reason, change_outline}]`（1〜`max-targets`）。path は corpus 内、runner が read 済みでなければ runner が read して存在と見出しを検証、sha256 を記録。
  - `decision: new` … 新規ノート。`new_note: {folder, kind, reason}`。folder は canon root 配下の **既存フォルダ**（attachments 除外）に限る。
  - `decision: ask` … 候補が複数 / 意味不明 / 相反。`question` + `candidates` の path を Blocked の質問 1 件として票に書く（推測で選ばない）。
- groom 結果（Context / AC / Plan）: 用途、対象 path と節、選定理由（モデル文を 200 字以内・wikilink 平文化・マーカー拒否）、予定差分（change_outline、同上）、対象 sha（先頭 16 桁）、新規なら保存先フォルダ、必読候補、守る制約、採用 / rollback の手順。frontmatter 固定: `docs-mode: amend|create`、`docs-target`、`docs-plan: <groom run id>`、`docs-kind`、`docs-folder`。計画の全文は `runs/BOXP-N/<groom run>/localllm-groom.edn`。
- Ready に直接置かれた自然文票（計画なし）: canon root へは書かず、従来どおり（create → proposals、propose → pilot）。canon への追記 / 編集は必ず Backlog groom の計画を Owner が見て assignee を戻す。

### 3. 新 mode `amend`（計画対象への限定追記 / 編集）

- `run-docs-amend!`: 計画を読む → 対象 sha が計画と一致（不一致 = groom 以降に同期 / 人手編集 → `localllm-plan-stale` で Blocked、再 groom）→ 対象に **他票の未確認スパン** があれば Blocked（nesting を作らない）→ 既存の research（corpus、対象は読み取り専用表示）→ amend 呼出（schema: decision / canon_facts / changes / conflicts / questions / sources）→ `verify-proposal!` → 既存 executor（`stage-proposal` / `commit-staged!`: 検証・backup・原子適用・write lock・競合 hash・失敗時 restore・journal）。
- 許可 op: `append-to-section`（計画の節）、`append-section`（計画が新節のとき）、`replace-text`（計画の節内の一意テキスト）。計画外 path / 計画外の節は拒否（修正ラウンド 1 回 → Blocked）。frontmatter / 編集範囲外リンク / コードフェンス / 表ヘッダ / 認証情報の既存検査はそのまま。
- 来歴マーカー（HTML コメント、Obsidian の閲覧では非表示）: 追記は `<!-- localllm:BOXP-N:RUN:add -->…<!-- /localllm:BOXP-N -->`、置換は `<!-- localllm:BOXP-N:RUN:replace old=<base64url(旧文)> -->新文<!-- /localllm:BOXP-N -->`。
  - `load-corpus`（他票の調査）では全スパンを **除去 / 旧文へ復元** して読む → 未承認案を他票の canon 根拠に自動採用しない。件数を `:unreviewed-spans` に記録。
  - Review 改稿: 同じ票のスパンを除いた本文を canon として渡し、前回のスパン内容を「前回の案」として渡し、新しい変更で **置き換える**（スパンは常に票ごとに 1 世代）。
  - 採用: `task_board_runner.bb localllm-accept BOXP-N RUN-ID` がマーカーを外す（置換の旧文も消える）。手で消してもよい。
  - 戻す: 既存の `localllm-rollback BOXP-N RUN-ID`（backup から復元、適用後に別編集があれば上書きしない）。
- 矛盾 / 質問 / 出典はノート本文に書かず、run dir の `localllm-amend-report.md` に保存し Notes には件数と path だけ（私的本文を Notes / 通知 / PR に出さない）。

### 4. create の保存先選択（実バース内の既存分類）

- groom の `decision: new` で固定した `docs-folder`（canon root 配下の既存フォルダ）に、`<slug>.md` を新規作成（上書きなし、名前 / aliases / slug の衝突検査は従来どおり）。frontmatter は `localllm-unreviewed: true` / `ticket` / `run` / `status: unapproved`、未確認バナー 1 行。
- `proposal-note?` を `localllm-unreviewed: true` にも反応させ、他票の corpus から除外（採用時は `localllm-accept` が frontmatter の `localllm-unreviewed` と `status: unapproved`、バナーを外す）。
- 票の自作ノート検索（`find-own-proposal`）を `docs-folder` にも広げ、改稿で 2 件目を作らない。
- `docs-folder` が無い（計画なし / 従来票）create は従来どおり proposals。

### 5. 安全境界（runner が強制）

- モデル呼出なしで止まる: canon 書き換え依頼の語句、docs-mode / docs-model 不正、Ready 直接の canon 書込、計画なし amend、計画 sha 不一致、他票スパンあり、Review で新指示なし。
- 選定結果の検証: path は corpus 内 + `resolve-vault-path`（canon root）+ `.md` + 非 attachments、節は `find-heading`（複数一致は拒否）、folder は既存ディレクトリ、件数は `max-targets` 以内、理由 / 概要は長さ・マーカー・未知 wikilink を検査。
- 書込は 1 run につき計画対象だけ、1 op 上限 `max-change-chars`、変更数 `max-changes`。vault 全域の一括改変経路なし。
- cloud 不使用（既存 fake CLI 検査）。Notes / groom 票本文に corpus 本文を載せない（理由 / 概要はモデル文として短く、本文の引用は検査で拒否はできないため README に注意として記載）。

### 6. runner

- `run-localllm-groom!`: モデル呼出を伴うため `stop-requested?` / `log-fn` / shutdown を docs-edit 経路と同様に扱う。`localllm-groom.edn` に計画（targets / sections / sha / outline / folder / model / research 要約）を保存。Notes の groom 行に用途・対象・model・調査量を記載（モデル呼出ありと明記）。
- `localllm-review-note` に amend の文面（対象 / 節 / op / 未確認スパン / accept と rollback コマンド）。
- CLI `localllm-accept BOXP-N RUN-ID`。

### 7. 配備

- arch PR（runner + テスト + plan.md）→ CI（`localllm-docs-test.sh` 等）→ codex review → merge → image → Pod 再作成（本 run は中断、後続 run が継続）。
- lolice PR: sidecar env `CODEX_TASK_BOARD_LOCALLLM_CANON_ROOTS=ひとはこさんバース`。他の env・モデル・既定は変えない。

### 8. 検証

- black-box（fake LLM、CI）: 合成バース fixture（似た名前 2 件、旧版 superseded、未承認案、無関係ノート、他票スパン、attachments 非 md）で、
  1. 自然文 Backlog → groom（research + 選定）→ Ready + boxp、pins と Context（理由 / 概要 / sha）、文書書込 0、類似名 / 旧版 / 無関係ノート不変
  2. assignee 戻し → amend 適用（計画節へマーカー付き追記）→ Review → 未変更 Review は Blocked → Notes 指示で同スパン改稿（2 スパン目なし）→ rollback → accept
  3. ask（複数候補）→ 質問 1 件で Blocked、pins なし
  4. new → `docs-folder` 固定 → 実フォルダに `localllm-unreviewed` 付き新規作成 → 他票の corpus から除外
  5. 計画 sha 不一致 → Blocked・未適用；他票スパンあり → Blocked
  6. 選定の path が corpus 外 / attachments / Tickets / 上限超 → Blocked；理由にマーカー / 未知 wikilink → 平文化・拒否
  7. 計画外の節 / path への変更 → 修正ラウンド → Blocked；replace-text の旧文がマーカーに保存され corpus 読込で復元される
  8. Ready 直接の自然文 → 従来の proposals；docs-model 不正は groom でもモデル呼出なし
- 配備後（通常 scheduler、Gemma4 既定、Qwen は docs-model 指定）: 対象パス指定なしの自然文票 → groom（実バース 28 ノートから選定、path / 件数のみ記録）→ Ready 確認 → **通常フォルダ内の専用非 canon 検証ノート** に限定して amend → Review → 同対象改稿 → rollback。既存原典は不変（sha256 全件）。create の保存先選定は groom（計画提示）まで確認し、原典フォルダへの実書込は Owner 票の groom 計画確認を経る。

## 結果 / 到達点（run ごとに追記）

- （実装 run で追記）
