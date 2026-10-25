# BOXP-306: localllm の review マーカー・専用 accept / rollback を廃止し通常ノートへ直接反映する

Owner 指示（Telegram）: 「このタグを使った rollback の仕組み自体なくしてほしい。戻したかったら Obsidian の history から戻せる」。

## 1. 現状（arch main 77b79f287 / 配備 Pod と同一系列）

| 要素 | 現行（BOXP-296 で導入） | 本票 |
| --- | --- | --- |
| amend（既存ノートへの追記 / 置換） | 変更を `<!-- localllm:TICKET:RUN:add -->` … `<!-- /localllm:TICKET -->`、置換は `replace old=<base64url 旧文>` で囲んで保存 | 通常の Markdown として保存（マーカー無し）。`new_text` に HTML コメントを書かせない guard は維持 |
| create（設定フォルダへの新規ノート） | frontmatter `localllm-unreviewed: true` / `status: unapproved` と「未確認（localllm）」バナー | 通常のノートとして保存（`ticket:` / `run:` / `kind:` の provenance frontmatter は維持） |
| corpus 読取（groom / research） | 全ノートで `strip-spans`（他票の追記を落とし、置換を旧文へ戻して読む）、`localllm-unreviewed` ノートは corpus から除外、マーカー破損ノートは除外 | 現在の本文をそのまま読む。`localllm-proposal: true`（提案 root の明示的未採用 proposal）・秘匿行の除去・許可 root・除外 path のルールは変えない |
| Review 改稿（同じ票の再実行） | 自票のスパンを丸ごと置き換え、前回文はスパン内から取得 | 前回 run の audit（`:applied` の `:after-sha256`）で「自票が書いた後か」を判定し、現在の本文をそのまま対象にして編集。前回文は run ディレクトリの amend report から取得 |
| 他票のスパンが残る対象 | `localllm-other-unreviewed` で停止 | 専用停止を廃止。対象 sha が計画時から変わっていれば従来どおり `localllm-plan-stale` で停止 |
| 採用 | `task_board_runner.bb localllm-accept TICKET RUN`（マーカー / 未確認印を外す） | 廃止。CLI は「廃止済み」を案内して何も書かずに終了（非 0） |
| 取消 | `task_board_runner.bb localllm-rollback TICKET RUN`（backup から復元） | 操作用 CLI は廃止（同上）。Owner は Obsidian 側の履歴機能で戻す。書込途中の失敗 / 中断 run の整合回復に使う backup・journal・`:after-sha256` 検査は「書込整合用の一時保全」として維持 |
| Notes / groom 計画の文言 | accept / rollback コマンド、マーカー内差分の案内 | 直接反映した旨と audit path。accept / rollback の案内を削除 |

## 2. 変更（boxp/arch）

### `docker/codex-workspace/task-board/localllm_docs.bb`
- `wrap-change` / `span-open` / `span-close` / `strip-spans` / `span-tickets` を削除。`parse-spans` / `unwrap-spans` は旧マーカー移行専用（下記 CLI）として残す。
- `interpret-amend`: 変更をそのまま返す。生成後の検査は「`<!-- localllm` を本文へ書かない」の不変条件だけ。
- `run-docs-amend!`: span-info / malformed / foreign を廃止。自票の前回書込は同じ票の run ディレクトリにある `:status :review` の audit から求める（`previous-write`）。hash gate は、前回書込があればその `:after-sha256`、無ければ groom 計画の sha と比較（人手編集 → `localllm-plan-stale` で停止、従来どおり）。
- `render-created-note` / `interpret-create`: 設定フォルダ宛ては `localllm-unreviewed` / `status: unapproved` / バナーを出さない。提案 root 宛て（`localllm-proposal: true`）は従来どおり。
- `proposal-note?`: `localllm-proposal: true` だけを見る。
- `load-corpus`: `strip-spans` を外し現在の本文を読む。`:unreviewed-spans` / `:malformed-span-notes` を削除。
- `list-unreviewed-canon-notes` を削除（新規ノートは corpus と既存ファイル検査で衝突を見る）。
- `accept!` を削除。`rollback!` は内部の整合回復専用（runner の中断 run 復旧 / 遷移失敗時）に残す。
- 新規 `migrate-markers!`（決定的・ローカル）: 許可 root（canon roots + docs roots、除外 path を除く）配下の `.md` を列挙し、`<!-- localllm:` スパン / `localllm-unreviewed: true` を持つノートだけを対象に、スパンのマーカーを外して新文を保持し、`localllm-unreviewed` / `status: unapproved` / 未確認バナー行を除去する。dry-run 既定、`--apply` で書込（write lock 下、適用直前に dry-run 時の sha256 と一致しなければそのノートだけ停止）。入れ子 / 不明形式 / 復号不能 / symlink / 上限超過はそのノートだけ非変更で理由を報告。`localllm-proposal: true` のノートと許可 root 外は対象外。再実行は対象 0 件（冪等）。出力は相対 path / 件数 / sha256 / 理由だけ。

### `docker/codex-workspace/task-board/task_board_runner.bb`
- `localllm-accept` / `localllm-rollback` サブコマンドは廃止案内を出して exit 2（ファイルを触らない）。
- 新規 `localllm-migrate-markers [--apply]`。
- Notes 文言（`localllm-review-note` / 中断復旧の note）から accept / rollback の案内を削除し、「通常ノートへ直接反映。戻す場合は Obsidian の履歴機能」を記載。

### groom 計画の文言（`localllm_docs.bb` 内）
- 「マーカー付き」「accept / rollback」を「対象の節へ直接反映。確認は Obsidian で、戻すなら Obsidian の履歴」に統一。

### テスト `tests/codex-workspace/localllm-docs-test.sh`
- 既存のマーカー / accept / rollback 前提の assertion を新方式へ書き換え（append / replace / create / revise、後続票が現在の本文を読む）。
- 追加: 旧マーカー移行（add / replace スパン 2 票分 + unreviewed ノート、新文維持・二重化無し・dry-run 非変更・apply 後の冪等・不明形式 / 入れ子で停止・apply 直前の人手編集で停止・許可 root 外 / symlink 非対象）、旧 CLI が何も書かないこと、生成本文に `<!-- localllm` が残らないこと。

### ドキュメント
- `docker/hermes-agent/skills/obsidian-task-board/SKILL.md` の rollback 案内を更新。
- vault（Obsidian Projects 正本）: `Projects/task-board-localllm-docs/README.md` の accept / rollback / マーカー説明を新方式へ。`Novels/README.md` は Task Board localllm のマーカーに言及していないため変更なし（確認済み）。過去の evidence / Notes は改竄しない。

## 3. 移行（実 vault、ローカル処理）
- 棚卸し（path / 件数のみ）: スパン = `ひとはこさんバース/キャラ設定/モブ/高嶺花学院ヒロイン部.md`（BOXP-301、replace × 8）。unreviewed ノート = `ひとはこさんバース/キャラ設定/モブ/yui-sasaki.md`（バナー / `status: unapproved` 付き）。Tickets / evidence 内の文字列は対象外（許可 root 外）。
- 手順: 配備済み（または本 worktree の）`task_board_runner.bb localllm-migrate-markers` を dry-run → 件数 / sha256 確認 → `--apply` → 再 dry-run で 0 件。

## 4. 検証・配備
- ローカル: `tests/codex-workspace/localllm-docs-test.sh`（全件）、`bb task_board_runner.bb test`、shellcheck。
- codex review → PR → CI → merge → image → lolice の Recreate rollout（BOXP-305 の配備と重ならないよう runs を確認）→ Pod 内 `localllm_docs.bb` / `task_board_runner.bb` の sha256 が main と一致 → 配備済み通常経路で隔離 fixture（`ひとはこさんバース/世界観設定/localllm検証ノート（BOXP-296・設定ではない）.md`、canon: false）に amend 1 件 → マーカー無しで反映、後続の groom がその本文を読むことを `:corpus` / read-paths で確認。

## 5. 記録（実施結果）

- 2026-10-25 実 vault への移行 dry-run（本 worktree の runner、`CANON_ROOTS=ひとはこさんバース`、書込なし）: 走査 40 ノート、移行対象 2 件（`ひとはこさんバース/キャラ設定/モブ/高嶺花学院ヒロイン部.md` = replace スパン 8、`ひとはこさんバース/キャラ設定/モブ/yui-sasaki.md` = `localllm-unreviewed` + バナー）、不明形式 0 件。Tickets / evidence 内のマーカー文字列は許可 root 外で対象外。
- 2026-10-25 実装の再適用: 中断 run が push した commit を origin/main（BOXP-302 merge 後）へ cherry-pick。テスト一覧の衝突のみ解消（302 のテストと 306 のテストを両方残す）。
- 2026-10-25 codex review（`codex review --base origin/main`）: P2 1 件 = 旧 `localllm-unreviewed` ノートの移行で、生成バナーと同じ書き出しの Owner 引用も本文全体から消えていた。修正: タイトル直後の生成形式に一致する 1 行だけを除去（`legacy-banner-re`）、テストに Owner 引用が残るケースを追加。
- 2026-10-25 ローカル検証: `tests/codex-workspace/localllm-docs-test.sh` 83 本 pass（exit 0）、`tests/codex-workspace/task-board-runner-test.sh` pass。
