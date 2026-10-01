# BOXP-200 実装計画

## 目的と現在の到達点

Tailscale管理認証をWIFへ段階移行する。今回はbootstrap前の検証経路と運用手順をレビュー可能にする。既存本番CIの切替・旧credential失効は未実施。

## 手順

1. 値を取得せず、追跡済みソースとGitHub Secret/Variableの名前だけで利用主体を棚卸しする。
2. `pull_request_target`がPRコードをcheckoutする現行CIの権限境界を確認する。管理WIFを直接渡さない。
3. main限定の手動workflowで、read-only Trust Credentialとprovider 0.29.2のnative OIDC discoveryを検証する。API keyは渡さず、planやstateや診断を出力しない。
4. bootstrap、claim/scope/tag、旧key維持、失敗時復旧と二重切替のrunbookを残す。
5. Operatorはissuer/JWKS外部到達性・audience・ServiceAccount subjectの証跡が揃うまで保留する。
6. 残存credentialはownerがexpiry/review metadataを登録し、T-30/T-7を手動管理する。Recurring Eventは配備確認なしで作成しない。
7. 静的検証と独立レビューを行いDraft PRを作成する。bootstrapと実CI/planが未確認ならBlockedを報告する。

## 移行完了条件

read-only API/実plan成功、信頼境界を保つproduction CIへのWIF接続、apply/tfmigrateを含む全consumer検証後に旧keyをrevokeする。PR作成や静的検証だけを移行完了とは扱わない。

## owner指摘への対応（2026-09-30）

client ID/audienceはTrust作成後の値であるため、arch専用`tailscale_federated_identity`と個別の非secret outputを追加する。既存認証を維持して対象resourceだけをbootstrapし、変数登録後にmain限定candidateを実行する。依存ACLの差分を確認し、auth key/SSMを巻き込むmodule全体applyは行わない。実applyとWIF認証成功は未確認として報告する。
