# BOXP-228 GitHub Git transportのSSH統一

## 目的と境界

codex-workspace内のGitHub向けclone/fetch/pull/pushを既存SSH鍵へ統一する。commitはローカル操作、gh APIは既存HTTPS OAuthを維持する。227のPR更新・CI・mergeは再実行しない。鍵/tokenの作成・登録・再ログイン・host key自動受入は行わない。

## 計画

1. 227最新Notes、runner claim、worktree所有、OSユーザー/HOME、鍵とknown_hostsの存在・権限だけを確認する。HTTPSが選択される設定と永続化元を調査する。
2. archのimage/bootstrapでworkspaceユーザー専用のGitHub URL rewriteと厳密SSH接続を導入する。既存remoteを変更せず、他hostとgh APIを維持する。冪等性とdotfiles setup後の継続性を確認する。
3. 隔離HOME/fixtureでclone/fetch/pull/push、新worktree、再bootstrap、競合設定、SSH失敗時の停止を検証する。既存鍵でHTTPS形式URLから実GitHub clone/fetchを検証し、この実装branchの通常pushでwriteを確認する。workflow writeは227の成功証拠を参照する。
4. codex-reviewとcodex-review-fileで変更/報告をレビューし、テストとrollback手順を保存、PRを作成する。
5. 稼働run終了/claim解放と外部引継ぎが確保されるまではPod更新やglobal切替を行わない。安全な反映時点を取れなければ準備済み・未反映を区別し、Obsidian Projectsへ証拠と制約を記録する。

## 初期調査

- 227最終runはreviewで終了、claimなし。workflow本体のSSH pushは成功しCIも完了。
- gh protocolはsshだがGitHub HTTPS URL rewriteがない。gh protocolだけでは既存HTTPS originを変更しない。
- 既存標準鍵とknown_hostsを利用したBatchMode/StrictHostKeyChecking=yesでboxpのGitHub認証、arch fetchを確認。SSH鍵にOAuth workflow scopeはない。
- 最新mainから今回のrun専用branchで作業する。既存run・共有checkout・資格情報の内容は変更しない。

## レビュー再試行: XDG環境境界

- カスタムXDG_CONFIG_HOMEを最終端末runuserのwhitelistとSSHログイン用session-envに追加する。
- カスタムXDGでの冪等bootstrapと実Git fixture clone/fetchを検証する。
- image CIで既定HOMEに加えカスタムXDGの起動を試し、端末プロセスの実環境、SSHログイン環境、GitHub URLのSSH解決を確認する。
- 同一PR #13622へ通常SSH pushし、CIとレビューを再確認する。稼働HOME/Podへの反映は引継ぎまで行わない。
