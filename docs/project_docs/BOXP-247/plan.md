# BOXP-247: Novel Board の Review 原稿・挿絵を Obsidian で閲覧できるようにする

- チケット: `Tickets/BOXP-247`（vault）
- 起点: BOXP-246 で配備済みの `docker/codex-workspace/novel-board/novel_board_runner.bb`（再実装しない）
- 設計正本: vault `Projects/novel-board-revival/README.md` に「草稿閲覧」節を追記

## 現状の問題

- runner は Review 到達時に本文と挿絵を `/home/boxp/.novel-board/work/NOVEL-N/` にだけ保存し、管理ノート `Novels/NOVEL-N.md` には絶対ローカルパスしか書かない。
- そのため owner は Obsidian（Vault Sync 先の端末）から本文も挿絵も読めない。localllm 試験 NOVEL-4 の生成物も同じ状態。

## 方針

1. **vault 草稿フォルダへの安全な同期**（全 agent 共通）
   - SFW: `Novels/Drafts/NOVEL-N/manuscript.md`、挿絵 `Novels/Drafts/NOVEL-N/attachments/illustration.png`
   - NSFW（カードの `#nsfw`）: `NSFW/小説/草稿/NOVEL-N/manuscript.md`、挿絵は同階層 `attachments/`
   - 草稿本文の先頭に「未承認草稿」であることと生成 agent / model / run / 同期時刻を書いたヘッダを付け、挿絵が実在する場合だけ相対画像リンクを入れる（偽リンク禁止）。
   - 同期タイミング: 本文生成成功（Review 到達）直後に加え、毎 tick でも Review のカードについて差分同期する（runner 再起動・失敗後の回復、再 tick の冪等性）。lock 中のカードは触らない。
   - 冪等/競合: `/home/boxp/.novel-board/drafts/NOVEL-N.edn` に「vault へ書いた内容の sha256」と「元原稿の sha256」を記録。元原稿が変わっていなければ何もしない。vault 側のファイルが runner の最後の書き込みと一致しない（人間が手で編集した）場合は上書きせず `manuscript.runner-<fingerprint>.md` として並置し、管理ノートの Preview に手動版と runner 更新版を明記する。
   - 境界: NOVEL-N は `NOVEL-\d+` のみ、草稿先の canonical path が vault 配下であること、途中の要素や既存ファイルが symlink なら拒否。本文は文字列としてコピーするだけで実行しない。prompt / credentials / API 応答 / log はコピーしない。
   - Done 承認後の完成版配置（`小説草案/AI執筆/` 等）は現状の publish のまま一度だけ。草稿フォルダは出版先ではなく、Done 後も未承認時点の閲覧用スナップショットとして保持する。完成版は管理ノートの既存 published-path / wiki link から辿る。
2. **管理ノートからの導線**
   - frontmatter に `draft-path` / `draft-illustration` / `draft-synced-at` / `draft-state`（`synced` / `partial`（挿絵なし）/ `conflict`）を追加。
   - 本文中に runner 管理の `## Draft Preview` 節を置き、未承認表示・`[[Novels/Drafts/NOVEL-N/manuscript|本文を読む]]`・`![[.../attachments/illustration.png]]`（存在時のみ）・生成 agent / model / run / 同期時刻 / 一部未完了を表示する。
   - 参照画像候補の収集から `## Draft Preview` 節を除外し、生成済み挿絵が改稿時の参照画像として再投入されないようにする。
   - Novel Board のカード末尾に `[[Novels/Drafts/NOVEL-N/manuscript|草稿]]` リンクを一度だけ付ける（Board からワンクリックで本文へ）。
3. **既存 NOVEL-4 の移管**: 新 runner の `sync-drafts NOVEL-4` を実 vault に対して一度実行し、`Novels/Drafts/NOVEL-4/` を作る。カードは Review のまま（Done にしない）。
4. **ドキュメント**: `vault-seed/Novels/README.md`、`Templates/Novel Management.md`、Board ルールカード、vault 側の同名ファイル、`Projects/novel-board-revival/README.md` を更新。
5. **検証**: black-box テスト（SFW 同期・NSFW 区分・挿絵失敗時 partial・人間編集の競合・publish 後の冪等・symlink 拒否・再 tick 無変更）を追加し CI。merge → build → 配備後、sidecar の実 API で専用の隔離 SFW fixture を localllm で執筆させ Review → `Novels/Drafts/` 到達と Obsidian 側の画像リンク整合を確認する。

## やらないこと

- 既存作品 / NSFW カード / NOVEL-3 を動かさない。テストカードを Done にしない。
- 新しいモデル download、driver / kernel 変更、新課金、外部公開なし。

## 引継ぎ後に具体化した安全策

- 成功した write/revise run の summary と Review 到達を確認した本文だけを同期する。失敗した改稿は前回の草稿を保持して更新待ちを表示。
- 草稿本文のリンク・HTML・transclusion・plugin code fence を文字参照へ変換し、runner が検証した添付リンクだけを有効にする。private 本文は変えない。
- 本文/画像/run/model/agent/NSFW を fingerprint に含め、同じ出力は state・画像・管理ノート・Board の mtime も維持する。
- private intent journal → atomic file replace → committed state の順で書き、再起動時は同一計画を再実行する。手動編集と未知の既存ファイルは上書きしない。競合画像も別ファイルへ保存する。
- NSFW 草稿は管理ノートからリンクのみとし、一般管理ノートへ画像を inline embed しない。NSFW から SFW への自動降格はしない。SFW→NSFW 再分類時は runner が所有する未編集の旧 SFW コピーだけを除去する。
- runtime の検証には既存 sidecar 内で専用 vault/root の fixture を使い、production カードを実行しない。NOVEL-4 の owner 向け草稿は実 vault に同期して server/local の画像 hash とリンクを照合する。
- 通常 GitOps rollout は singleton Pod 全体を再作成するため、他 Task Board run が active な間に強行せず、安全な区切りで配備を引き継ぐ。
