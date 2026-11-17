# obsidian581auto.mjs（BOXP-581 再報告）

実際の家の会話や Task Board 通知は、票 ID（`BOXP-590` など）やパスを文字で書くだけのことが多く、「Obsidianで開く」リンクが出ていませんでした。このスクリプトは、そうした文面でも画面がリンクにすることを、ローカル BFF と認証済み Hermes のモックで PC と Pixel 7 相当（タッチ）について確認します。先に BFF と web をビルドし、Playwright 1.56.1 と vault 外の `OUT` を用意します。

- 会話の吹き出し: 票 ID、`/home/boxp/Documents/obsidian-headless/BOXP/…md` の絶対パス（日本語を含む）、コード表記の `Tickets/BOXP-N.md` がリンクになり、作業ブランチ名はリンクにならないこと。既存の https リンクと履歴表示が保たれること
- 受信箱の通知: 実際の通知と同じく太字の中にある `[PR #…](https://…)` や票 ID もリンクになること
- クリック/タップでページが `obsidian://open?vault=BOXP&file=…` の起動要求を出し、ページ自体は遷移・新規タブを作らないこと

アプリが入った実機で指定ノートが実際に開くかは、このスクリプトでは確認できません。
