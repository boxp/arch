# BOXP-268: Ansible Plan の CP 直列・worker 並行化

調査・判断・実行結果の正本: Obsidian `Projects/BOXP-268/README.md` と `evidence.md`。

1. 最新 main・関連 PR・実行中 Actions を確認する。専用 worktree を使用する。
2. ノード実行を共通 workflow に移し、CP matrix は max-parallel: 1、worker は独立 job とする。
3. SSH/600MiB headroom ガード、300秒/30秒待機、認証・秘密マスク、playbook/引数を保持する。
4. 両 group の失敗時も集約し、欠落・部分失敗・skip・重複を「変更なし」と扱わない。回帰テストを CI に接続する。
5. actionlint / ghalint / セキュリティ確認と Codex review を実施し、実変更 PR の Actions の時刻・artifact・コメントを確認する。
6. 通常の CI/review/merge ゲートに従い、可能な範囲で main の revision と反映結果を確認する。

Apply/Upgrade・本番 playbook・権限・CP 並列数を変更しない。検証専用の重複 Plan は起動しない。
別 PR 間の CP 排他は現状存在しない。本票では concurrency group を追加せず、pending 置換と required check 滞留を含む別設計事項として残す。
比較可能な実測がなければ短縮秒数は主張しない。
