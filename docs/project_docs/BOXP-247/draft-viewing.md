# Review 草稿の閲覧（BOXP-247）

## 承認と出力の境界

owner の「Obsidian で Review 原稿と挿絵を読む」依頼により、草稿の Vault Sync を許可する。本文・挿絵の原本は private work dir に保持する。prompt、credentials、raw API、log を vault に出さない。本文を外部サイト・公開 Git・通知に出さない。Done 承認と完成版の一度だけの配置は従来どおり。

## 読む場所

- Board → `Novels/NOVEL-N.md` → `Draft Preview` の wiki link で本文、画像埋込で挿絵を確認。
- SFW: `Novels/Drafts/NOVEL-N/manuscript.md` と同階層 `attachments/`。
- NSFW: `NSFW/小説/草稿/NOVEL-N/manuscript.md` と同階層 `attachments/`。一般向け草稿フォルダへコピーしない。分類入力の正本はカードの正規タグで、frontmatter は表示値、Requirements は執筆条件。過去に NSFW として同期した草稿の SFW への自動降格は拒否する。
- 草稿には未承認表示と生成 agent/model、更新状況を表示。画像失敗時も本文は閲覧でき、一部未完了を明記し偽リンクを置かない。

## 更新と回復

Review 到達時に同期し、以後の tick でも欠落・改稿を回復する。private 状態に出力のハッシュを保持し、差分がない再 tick は書き換えない。人間が編集した草稿は自動で上書きせず、runner 更新版を別ファイルへ置き、管理ノートに競合と両版への導線を示す。草稿から private 原本へ逆同期しない。原本・履歴を削除しない。草稿は出版先に入力せず、完成承認は private 原本を使う。

ID は NOVEL-N に制限し、出力先の vault 境界と symlink を検証する。生成本文は実行せず、Obsidian から外部や任意ファイルを自動参照するリンクを無害化する。草稿プレビュー画像は次の改稿の参照画像に自動投入しない。

## 検証記録

実装・テスト・NOVEL-4 移管・実機 E2E・同期観測の確定結果は作業完了時に追記する。NOVEL-3 / BOXP-245 は別作業のまま維持し、既存作品や NSFW カードを動かさず、試験カードを Done にしない。
