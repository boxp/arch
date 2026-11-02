# BOXP-307: Novel Board: Draft から Backlog へ戻した既存作品を再採番せず同一 ID で再 groom する

## 調査結果（2026-10-25、非本文メタデータと合成 fixture のみ）

- 配備済み runner は BOXP-305 merge 後の arch main と一致（305 Notes で sha256 確認済み）。
- private state に `assignee-sync/NOVEL-8.edn`（16:43 UTC, boxp）だけが残り、`Novels/NOVEL-8.md` もカードも無い。旧 runner が一度 `NOVEL-8` を新規採番し、人間が削除した痕跡。同日 16:15 UTC に `NOVEL-7` が groom → Draft、18:07 UTC に Backlog から同一 ID で再 groom 成功、18:16 UTC に Draft regroom（live run、未接触）。
- 実カードは全件 `[[Novels/NOVEL-N|NOVEL-N: 題]]` 形式。16:43 UTC 時点のカード文面は Loki に到達できず特定不能。
- 構造的原因: `novel-id-from-card` が `[[Novels/NOVEL-N|…]]` / `[[Novels/NOVEL-N]]` しか認識しない。Obsidian の通常リンク表現（最短パス `[[NOVEL-N]]`、Markdown リンク `[題](Novels/NOVEL-N.md)`、`.md` 付き、`\|` エスケープ）や ID 文字列だけのカードは Backlog で「未リンク行」として新規採番されるか（`[[` を含む場合は）無言で無視される。
- 管理ノート欠損・同一 ID の重複カード・同名タイトルの新規カードも無言で処理されるか新規採番される。

## 設計

1. **既存作品への一意解決**: カード行から NOVEL 参照を収集（wiki / Markdown リンク、`.md`、`#見出し`、`\|`、草稿リンク `Novels/Drafts/NOVEL-N/…` / `NSFW/小説/草稿/NOVEL-N/…`）。リンク参照が 1 つの ID に一意で管理ノートが存在すれば既存作品として扱い、非正規形は `[[Novels/NOVEL-N|NOVEL-N: 題]] #novel …` に正規化（題はカード別名 `NOVEL-N: 題` か管理ノート frontmatter `title`）。ID 文字列だけ（リンクなし）は関連付けない。
2. **解決不能は採番せず理由を表示**: ID 文字列のみ / 管理ノート欠損 / 複数 ID / 同一 ID のカード重複 / 同名の既存作品 / タイトルにリンク、は scaffold も実行もせず、カード末尾に `⚠ runner: 理由` を 1 回だけ付ける（理由が変わればその理由に置換、解消すれば runner が外す）。重複カードは Run History にも件数とレーンを 1 回記録。`Novels/` 配下の重複ノートは件数と相対 path だけ log と Run History に 1 回報告し、削除・統合はしない。
3. **採番**: Board 上の全参照・`Novels/*.md`・private state（work / runs / published / drafts / assignee-sync / instructions / skips）・草稿ディレクトリの最大 ID + 1。削除済み ID を再利用しない。
4. **Backlog 再 groom**: 既に Requirements / Outline が埋まっている作品の `:groom` は「要件の再整理」として、既存の企画と Review Instructions を土台に設定探索をやり直して更新する旨を prompt と Run History に明示する。Draft（boxp）へ戻し、本文執筆には落とさない。Draft の未反映指示 → regroom の既存ルートと既反映判定は変更しない。
5. **変更しない境界**: レーン→status/frontmatter 同期、担当の双方向同期、lock / heartbeat / planned shutdown、write / revise / 挿絵 / Done 配置、NSFW 分類、BOXP-305 の設定探索、BOXP-306 の Task Board 側変更。

## 検証

- `bb novel_board_runner.bb test`（参照解決・正規化・scaffold 判定の self test）と `tests/codex-workspace/novel-board-runner-test.sh` section 17: Kanban 相当の行移動で Draft → Backlog → 同一 ID で再 groom（複数回往復、ノート数不変、本文未生成、Reference Context 置換、Draft + boxp）、リンク形式ごとの正規化、ID 文字列のみ、管理ノート欠損、重複カード、同名別作品、タイトル内リンク、status 属性不整合、run 中の手編集、再起動（stale lock）、rule 除外、新規作成の正常系。新 section は修正前 runner で失敗することを確認する。
- merge → image build → image-updater → Argo で Pod 再作成 → runner sha256 一致 → 配備済み runner container 内の一時 vault / root + 実 llama-server で同一 ID の 2 回 groom を確認（live vault / 実作品は未接触、本文未生成）。
