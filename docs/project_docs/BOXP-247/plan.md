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
   - 草稿本文の先頭に「未承認草稿」であることと生成 agent / model / run / 同期時刻 / 挿絵の有無を書いたヘッダを付け、挿絵が実在する場合だけ相対画像リンクを入れる（偽リンク禁止）。
   - 同期タイミング: 本文生成成功（Review 到達）直後に加え、毎 tick でも Draft/In Progress/Review のカードについて差分同期する（runner 再起動・失敗後の回復、再 tick の冪等性）。lock 中のカードは触らない。
   - 冪等/競合: `/home/boxp/.novel-board/drafts/NOVEL-N.edn` に「vault へ書いた内容の sha256」と「元原稿の sha256」を記録。元原稿が変わっていなければ何もしない。vault 側のファイルが runner の最後の書き込みと一致しない（人間が手で編集した）場合は上書きせず `manuscript.runner-<run-id>.md` として並置し、Run History に明記する。
   - 境界: NOVEL-N は `NOVEL-\d+` のみ、草稿先の canonical path が vault 配下であること、途中の要素や既存ファイルが symlink なら拒否。本文は文字列としてコピーするだけで実行しない。prompt / credentials / API 応答 / log はコピーしない。
   - Done 承認後の完成版配置（`小説草案/AI執筆/` 等）は現状の publish のまま一度だけ。草稿フォルダは出版先ではなく、publish 後は草稿ヘッダに完成版パスを追記する（人間編集があれば触らない）。
2. **管理ノートからの導線**
   - frontmatter に `draft-path` / `draft-illustration` / `draft-synced-at` / `draft-state`（`synced` / `partial`（挿絵なし）/ `conflict`）を追加。
   - 本文中に runner 管理の `## Draft` 節を `## Requirements` の前へ置き、未承認表示・`[[Novels/Drafts/NOVEL-N/manuscript|本文を読む]]`・`![[.../attachments/illustration.png]]`（存在時のみ）・生成 agent / model / run / 同期時刻 / 一部未完了を表示する。
   - 参照画像候補の収集から `## Draft` 節を除外し、生成済み挿絵が改稿時の参照画像として再投入されないようにする。
   - Novel Board のカード末尾に `[[Novels/Drafts/NOVEL-N/manuscript|草稿]]` リンクを一度だけ付ける（Board からワンクリックで本文へ）。
3. **既存 NOVEL-4 の移管**: 新 runner の `sync` サブコマンド（草稿同期を含む）を実 vault に対して一度実行し、`Novels/Drafts/NOVEL-4/` を作る。カードは Review のまま（Done にしない）。
4. **ドキュメント**: `vault-seed/Novels/README.md`、`Templates/Novel Management.md`、Board ルールカード、vault 側の同名ファイル、`Projects/novel-board-revival/README.md` を更新。
5. **検証**: black-box テスト（SFW 同期・NSFW 区分・挿絵失敗時 partial・人間編集の競合・publish 後の冪等・symlink 拒否・再 tick 無変更）を追加し CI。merge → build → 配備後、sidecar の実 API で SFW 試験カードを localllm で執筆させ Review → `Novels/Drafts/` 到達と Obsidian 側の画像リンク整合を確認する。

## やらないこと

- 既存作品 / NSFW カード / NOVEL-3 を動かさない。テストカードを Done にしない。
- 新しいモデル download、driver / kernel 変更、新課金、外部公開なし。
