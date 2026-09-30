# Owner向けDecision Packet — BOXP-201

**今回の一決定**: v2の初回対象を「新規canaryのみ」とする方針で進めるか。

**推奨**: 新規canaryのみ。既存ticketの停止状態・scopeを推測しないで検証できる。代替はshadow-onlyを維持し、起動差分の観測だけを続ける。

**根拠**: 現runnerはassigneeを起動指示として扱い、終了時boxpへ戻す。既存PR gate retryはあるが一般Blockedの条件・総budgetがない。旧runnerとv2の混在writerは誤起動を起こし得る。

**影響**: 方針選択後、[分割ticket I1〜I7](implementation-tickets.md)を別途作成・検証する。今回の文書PRからrunner/Deployment/Argo/cron/既存ticketへの実行効果はない。本番配布許可はこの判断に含めない。

**rollback**: 限定配布の際に受付停止→canary pause→checkpoint/drain→journal保存→legacy復帰前の起動抑止確認を実施する。詳細は[設計](design.md)。

**レビュー成果**: [計画](plan.md)・[設計とschema例](design.md)・[実装ticket本文案](implementation-tickets.md)。このpacketの許可対象はレビュー対象commitの移行方針だけ。未回答/期限切れは許可を意味せず、次の安全な設計/fixture作業は進められる。本番配布直前に対象head/revision/期限付きpacketを発行する。

**後続でownerが判断する未解決事項**（今すべての回答を求めない）:

- canary対象repo/ticketと実行window。既存ticket移行は個別選択。
- 初期global WIP=2、per_repo=1、6step/60分、retry最大3回の上限。費用上限は計測後に別途設定。
- digest 60分・24時間後reminder一度の通知先、監査artifactの保存期限/アクセス権。外部送信は明示許可後。
- 将来の低リスクmerge許可を検討するか。初期policyではmerge/deploy/applyはhuman decisionを維持する。
