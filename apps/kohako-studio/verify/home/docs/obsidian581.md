# obsidian581.mjs（BOXP-581）

家の会話で vault 内ノートを `[ノート名](obsidian://open?vault=BOXP&file=エンコード済み相対パス)` と返したとき、「Obsidianで開く」リンクになることを、ローカル BFF と認証済み Hermes のモックで PC と Pixel 7 相当（タッチ）について確認します。先に BFF と web をビルドし、Playwright 1.56.1 と vault 外の `OUT` を用意します。

- 日本語・空白・括弧・`&`・`+` を含むパスの符号化、素の `obsidian://open?...` の自動リンク化、同じタブのまま（新規タブなし）
- `obsidian://new`・他 vault・`javascript:` はリンクにならないこと、既存の https リンク・vault 画像・履歴表示が保たれること
- クリック/タップでページが `obsidian://` の起動要求を出し、ページ自体は遷移しないこと

アプリが入った実機で指定ノートが実際に開くかは、このスクリプトでは確認できません。
