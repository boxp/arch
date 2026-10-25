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

### 2026-10-25 run 20261025T034921Z（実装・PR）

- 実装は設計どおり（`localllm_docs.bb` +1,200 行、`task_board_runner.bb` +70 行、black-box +560 行）。arch PR boxp/arch#13979（#13952 を土台に含む）、lolice PR boxp/lolice#885。
- 検証: `localllm-docs-test.sh` 全 77 本 pass（新規 6 本: 選定 groom → amend → 他票非表示 → 改稿 → rollback 連鎖 / 複数対象 + replace + accept（all-or-nothing）/ ask・不正選定・canon 書換語・未知 model・Qwen 選択 / 実フォルダへの新規ノートと非表示・同名拒否・採用後の改稿 / stale・他票スパン・計画なし・CANON_ROOTS なし / 計画外の節・見出し行・新節計画の境界・needs-human）、runner / events / source-check / vault-writer / inline test pass。
- codex review 6 回: P1 ×2（新節計画で既存節へ書ける・見出し行の置換）、P2（同フォルダ未確認ノートとの名前衝突）、accept の部分採用、採用後の同票改稿で 2 件目作成、選定 root の広がりと undecodable な replace マーカー → すべて修正・テスト追加。
- 設計上の判断: Ready に直接置いた自然文票は従来経路（proposals / pilot）のまま（実フォルダへの書込は必ず groom 計画の確認を通す）。選定理由・予定差分はモデル文を 300 字以内で票に載せる（Owner 要件「選定理由 / 予定差分を groom で提示」。本文の長い引用はプロンプトで禁止し、未知 wikilink は平文化、マーカーは拒否）。
- 未実施（後続 run）: merge → image → Pod 再作成 → lolice#885 merge → 実 Gemma4 / Qwen で『自然文 → groom（実バース 28 ノートから選定、path / 件数のみ記録）→ Ready 確認 → 専用非 canon 検証ノートへ限定 amend → Review → 同対象改稿 → rollback』。新規ノートの実フォルダ保存は groom（保存先の提示）までを実バースで確認し、原典フォルダへの実書込は Owner 票の計画確認を経る。

#### 後続 run の E2E 手順（配備後）

1. 新 Pod で `/opt/codex-workspace/task-board/{localllm_docs,task_board_runner}.bb` の sha256 が arch main と一致し、env `CODEX_TASK_BOARD_LOCALLLM_CANON_ROOTS=ひとはこさんバース` が入っていることを確認（lolice#885 merge 後）。
2. 検証ノートを用意: `ひとはこさんバース/世界観設定/localllm検証ノート（BOXP-296・設定ではない）.md`（frontmatter `canon: false`、見出し `## 検証メモ` 1 つ。本文は非私的な数行）。既存原典 28 ノートの sha256 を記録。
3. 票 A（Gemma4 既定）: Backlog に `assignee: localllm`、題名「localllm 検証ノートに項目を追記」、Summary「ひとはこさんバースの localllm 検証ノート（設定ではない）の検証メモに、検証用の項目を 1 行追記してほしい。他のノートは変えない。」→ groom が検証ノートを選ぶか（Context の対象 path / 節 / 理由）を確認。別のノートを選んだら assignee を戻さず Blocked / 再 groom を記録（選定品質の到達点として報告）。
4. assignee を localllm に戻す → amend → Review: 検証ノートのマーカー内だけに追記、原典 28 ノートの sha256 不変、Notes の操作 / report / accept / rollback コマンド。
5. Notes に改稿指示 1 行 → 同スパン置換 → Review。`localllm-rollback` で原本復帰、再適用後に `localllm-accept` を試し、最後に検証ノートを削除（または残して `canon: false` のまま）。
6. 票 B（`docs-model: qwen38-27b`）で 3〜4 を繰り返す（GPU 直列、Gemma4 の再ロード待ちあり）。
7. 新規保存先の選定: 票 C「新しい脇役を 1 名いつものフォルダに」を Backlog に置き groom の保存先提示（docs-folder）まで確認し、assignee は戻さない（原典フォルダへの実書込は Owner 判断）。
8. evidence: `Projects/task-board-localllm-docs/evidence/e2e-BOXP-296/README.md` に run id・path・件数・sha256 不変だけを記録（本文なし）。README 現状表と本 plan に到達点 / 未確認を追記。
