# Review 草稿の閲覧（BOXP-247）

## 承認と出力の境界

owner の「Obsidian で Review 原稿と挿絵を読む」依頼により、草稿の Vault Sync を許可する。本文・挿絵の原本は private work dir に保持する。prompt、credentials、raw API、log を vault に出さない。本文を外部サイト・公開 Git・通知に出さない。Done 承認と完成版の一度だけの配置は従来どおり。

## 読む場所

- Board → `Novels/NOVEL-N.md` → `Draft Preview` の wiki link で本文、画像埋込で挿絵を確認。
- SFW: `Novels/Drafts/NOVEL-N/manuscript.md` と同階層 `attachments/`。
- NSFW: `NSFW/小説/草稿/NOVEL-N/manuscript.md` と同階層 `attachments/`。一般向け草稿フォルダへコピーしない。分類入力の正本はカードの正規タグで、frontmatter は表示値、Requirements は執筆条件。過去に NSFW として同期した草稿の SFW への自動降格と一般向け完成版配置は拒否する。
- 草稿には未承認表示と生成 agent/model、更新状況を表示。画像失敗時も本文は閲覧でき、一部未完了を明記し偽リンクを置かない。

## 更新と回復

Review 到達時に同期し、以後の tick でも欠落・改稿を回復する。private 状態に出力のハッシュを保持し、差分がない再 tick は書き換えない。人間が編集した草稿は自動で上書きせず、runner 更新版を別ファイルへ置き、管理ノートに競合と両版への導線を示す。草稿から private 原本へ逆同期しない。原本・履歴を削除しない。草稿は出版先に入力せず、完成承認は private 原本を使う。

ID は NOVEL-N に制限し、出力先の vault 境界と symlink を検証する。生成本文は実行せず、Obsidian から外部や任意ファイルを自動参照するリンクを無害化する。草稿プレビュー画像は次の改稿の参照画像に自動投入しない。

## 検証記録

実装は arch PR https://github.com/boxp/arch/pull/13795。テスト・NOVEL-4 移管・実機 E2E・同期観測は下記を参照。NOVEL-3 / BOXP-245 は別作業のまま維持し、既存作品や NSFW カードを動かさず、試験カードを Done にしない。

### 2026-10-19 実機観測（配備前）

- 既存 NOVEL-4: `Novels/Drafts/NOVEL-4/manuscript.md`（未承認ヘッダ付き 7,159 B）と `attachments/illustration.png`（769,112 B）へ複写。管理ノートと Board に wiki 導線を生成、Review / boxp を維持。private 本文 hash `b4fdffe0…`、PNG `0376ca9c…` は不変。
- 再同期: 本文・画像・管理ノート・Board・private state の hash/mtime が全て不変。
- Sync: local_files/server_files の記録で、草稿本文・出力PNG・参照画像3枚の hash 一致と deleted=false を確認。画像の同期除外なし。これは Sync サーバ側記録の観測で、owner 端末の Obsidian UI は直接確認していない。
- 隔離 SFW E2E: production の `novel-board-runner` コンテナ内から専用 fixture vault/root に対して候補 runner を実行。NOVEL-24701 は実 Gemma4 API で本文 1,325 字（591/927 tokens, finish_reason=stop）と挿絵計画を生成、実 PNG 732,905 B → Review/boxp → vault 草稿まで到達。初回 write は HTTP 500、既定再試行の2回目で成功。モデル切替・download・サービス再起動は実施せず。
- fixture の管理ノート/草稿画像リンク実在、private/草稿PNG同一hash、画像目視済み。production 作品カードの実行・Done・完成版配置なし。
- 非秘密検証記録: `/home/boxp/.novel-board/validation/BOXP-247/`。この private root の prompt/log は vault にコピーしない。

### 自動テストとレビュー

- runner self-test と black-box suite が全件成功。新規検証は SFW/NSFW 草稿と導線、同値同期の不変性、本文/画像の手動編集、初回既存ファイル保護、pending journal の部分書込み回復と中断中の人手変更、画像失敗後の古いリンク除去、HTML/wiki/URI 無害化、source/destination symlink 拒否、cloud agent/model、NSFW 降格時の SFW 完成版拒否。従来の Done 画像出版・重複防止テストも維持。
- 独立 Codex review の P2（中断中の手動編集による永続失敗）を修正し、回帰テスト成功。文書レビューの分類優先順位/競合版の扱いも明記。
- `trivy config` のチェック取得が停止したため、`--skip-check-update` で全体を走査して完走。既存の Dockerfile/Terraform 設定に指摘があるが、この変更ではそれらを変更していない。
- 委任範囲: 低コスト worker がテスト追加・検証を担当。親が runner の安全性/回復処理を統合し、文書・実機・PR と最終レビューを担当。
