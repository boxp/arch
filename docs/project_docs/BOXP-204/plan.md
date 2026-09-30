# BOXP-204 実施計画

## 成果と範囲

共有HOME上のCodex / Claude Codeの認証失効を予防・検知し、providerごとに停止・復旧する設計をレビュー可能にする。本票は設計と分割実装案まで。runtimeコード、認証情報、Secret、Deployment、Board laneは変更しない。

2026-09-30のowner指定に従い、両CLIともsubscription認証だけを使用する。API key・その環境変数・provider API key fallback・課金方式切替を禁止する。公式subscription loginとCLI内蔵の公式更新経路だけを候補とし、維持できなければownerの公式再ログインを待つ。独自OAuth endpointは呼ばない。

## 手順

1. Notes、BOXP-202/192/201、専用worktree、現mainと過去配備commit、CLI起動/cron排他を読み取り調査する。credential本文・Secret data・生ログは読まない。
2. CodexとClaudeを別表で棚卸しし、観測済み・コード上の仕様・公式仕様・未確認を区別する。
3. [design.md](design.md)に診断状態、期限・通知、provider別受付、並列利用/永続化、秘密値を出さない出力契約を定義する。
4. [implementation-and-runbook.md](implementation-and-runbook.md)にarch/lolice/ownerの分割案、対象ファイル、fakeテスト、段階導入、rollbackと復旧手順を記載する。
5. 受入条件との対応、ローカル参照、差分の秘密値/禁止方式、独立レビューを確認する。文書のみのためruntimeテスト・実provider probeは実施しない。
6. 専用ブランチをpushして設計PRを作成し、Notesへ成果と制約を追記する。owner候補boxpによる設計確認へ返す。

## 実施記録

- 提供worktree HEAD e53ce4e8fはclean。origin/main a46e4e43dへfast-forwardした（専用ブランチ名は維持）。今回のPR差分は本票文書のみ。
- 過去配備image参照のcommitはcee9e99117535cbffd5d21c8dddf60ed7c75698e。最新live Pod/digestはこのrunでは再照会せず、過去観測を現在配備と断定しない。
- 指定worktree / multi-repo-dev / obsidian-task-board / OpenAI Docsの指示を適用。codex-review / codex-review-fileも読み、認証を更新し得る別CLI起動を避けるためチーム内の独立レビューで代替する。Git管理外ファイルのレビュー対象はない。
- terra_workerの起動は利用不能だったためexplorerへコード調査を委譲。親が公式根拠・チケットとの整合を確認した。独立レビューのprovider lock自己待ち指摘を反映し、同session委譲の直列化/独立session必須・入れ子lock禁止を追記した。
- 文書のlocal link、code fence、秘密値パターン、git diff --checkを検証。runtime試験/実provider probeは未実施。GitHubでarchのPUBLIC可視性を確認し、公式CI/CD維持例を同repoへ適用しない制約を反映した。

## PR gate再試行（2026-09-30）

- PR #13043のcodex-review P1（lockの全利用者範囲とHOME別retry/hold状態の不一致）に対応する。同PR head 0a13eebbcを今回の専用worktreeへfast-forwardし、同じPR branchへ追加commitをpushする。
- 認証session単位の非秘密refと共有耐久正本、atomicな再診断予算予約、lock/state範囲一致、全利用者が参加できない場合のenforcement導入禁止をdesignに追加。分割案・fakeテスト・owner再開を同じ契約に揃える。
- 最終検証: local link/code fence/秘密値パターンとgit diff --checkが成功。terra_worker利用不能のため低コストlunaへ独立レビューを委譲し、正常検査とunknown episode予算の区別を補足後、追加指摘なしを確認した。
- review skillsはdotfilesのSKILL.mdを参照。別CLIの認証更新を避け、独立チームagentに文書レビューを委譲する。最終PR gateはrunnerが実施する。credential操作/実provider probeは実行しない。

## 承認境界

設計PRのレビュー/mergeから、credential読取り・変更、login/refresh probe、Secret注入、外部通知、provider操作、rolloutの実行許可を推論しない。fakeテストと秘密値を扱わない設計は先行できる。採用実装と実環境操作は対象commit・provider・利用者・期限・rollbackを特定した別承認で行う。
