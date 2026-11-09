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

## 本番CIの切替（2026-10-01）

手動dispatchのWIF planが成功したので、tfactionのplan/applyをWIFへ切り替える。

1. PRのplan用（read-only）とmainのapply用（write）のTrust Credentialを分けて追加する。claim条件はevent、workflow、refで限定する。
2. `wc-plan.yaml`と`apply.yaml`は、非secretの変数`TAILSCALE_WIF_CI_PLAN_CLIENT_ID` / `TAILSCALE_WIF_APPLY_CLIENT_ID`が登録されているときだけWIFを使う。変数を消せばAPI key経路へ戻る。
3. Trustを追加するPR（#13077）のmerge後、ownerが変数を登録してplanとapplyの成功を確認する。その後にAPI keyの参照を削除し、revokeする。
4. Operatorは公開OIDC issuerの前提を満たさないため実装せず、BOXP-206へ分離する。
5. 残存credentialの期限通知はRecurring Eventsへ登録し、dry-runでcandidateを確認する。

手順と復旧は`runbook.md`の「本番CI（tfaction）のWIF切替」に記載する。
