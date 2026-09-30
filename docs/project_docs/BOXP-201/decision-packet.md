# Owner向けDecision Packet — BOXP-201

**種別**: 設計レビュー用の要約。実行承認を要求する発行済みpacketではない。[設計のYAML例](design.md#decision-packet契約)も未発行テンプレートであり、head・期限のプレースホルダを含むため承認の記録には使用できない。

**今回の一決定**: v2の初回対象を「新規canaryのみ」とする方針で進めるか。

**推奨**: 新規canaryのみ。既存ticketの停止状態・scopeを推測しないで検証できる。代替はshadow-onlyを維持し、起動差分の観測だけを続ける。

**根拠**: 現runnerはassigneeを起動指示として扱い、終了時boxpへ戻す。既存PR gate retryはあるが一般Blockedの条件・総budgetがない。旧runnerとv2の混在writerは誤起動を起こし得る。

**影響**: 方針選択後、[分割ticket I1〜I7](implementation-tickets.md)を別途作成・検証する。今回の文書PRからrunner/Deployment/Argo/cron/既存ticketへの実行効果はない。本番配布許可はこの判断に含めない。

**rollback**: 限定配布の際に受付停止→canary pause→checkpoint/drain→journal保存→legacy復帰前の起動抑止確認を実施する。詳細は[設計](design.md)。

**レビュー成果**: [計画](plan.md)・[設計とschema例](design.md)・[実装ticket本文案](implementation-tickets.md)。今回求めるのは移行方針への設計フィードバックだけであり、回答から実行許可を生成しない。未回答も許可を意味せず、独立した安全な設計/fixture作業は進められる。I6/I7で認証経路と分離を検証した後、本番配布直前に対象commitの完全SHA・現在のcontrol revision・具体的なUTC期限を確定した別packetを発行する。その承認は[認証と承認event契約](design.md#回答の認証と承認event)に従うowner専用経路で記録し、packetのstatusやowner名の記載だけでは許可しない。この要約自体は承認eventではない。

**後続でownerが判断する未解決事項**（今すべての回答を求めない）:

- canary対象repo/ticketと実行window。既存ticket移行は個別選択。
- 初期global WIP=2、per_repo=1、6step/60分、retry最大3回の上限。費用上限は計測後に別途設定。
- digest 60分・24時間後reminder一度の通知先、監査artifactの保存期限/アクセス権。外部送信は明示許可後。
- owner認証provider・不変subject登録、署名方式、agent書込不可の承認store/サービス配置。分離の検証前にhuman-dependent effectは有効化しない。
- 将来の低リスクmerge許可を検討するか。初期policyではmerge/deploy/applyはhuman decisionを維持する。
