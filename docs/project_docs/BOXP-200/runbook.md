# BOXP-200: WIF準備と残存credentialのrotation runbook

## 現在の到達点

この変更はPRレビュー用のprepare段階であり、認証移行の完了を意味しない。Trust Credentialのbootstrap、GitHub変数登録、WIFによる実API read、実stateをrefreshするTerraform plan、既存production CIのWIF切替・成功確認、旧credentialのrevokeは未実施である。既存CIのAPI key経路を維持する。candidateだけの成功で旧keyを削除してはならない。

担当ownerはboxp。以下の棚卸しはリポジトリの設定とGitHub登録metadataを根拠にした利用主体一覧である。GitHubにはSecret名`TAILSCALE_API_KEY`の登録があることを確認済みで、repository variablesは空、Environmentも未登録である。Secretの値は閲覧していない。実際にactiveなcredentialの全数・最終利用日時・有効期限・実scopeは、値を表示しないTailscale管理画面のmetadata確認が未実施のため未確定である。登録が存在することと現在利用中であることを区別する。

## 値を扱わないソース棚卸し

| 利用主体 / 種別 | 確認できた設定と根拠 | active / scope / expiryの未確認点 |
| --- | --- | --- |
| boxp/arch Terraform・tfmigrate / API key | `terraform/tailscale/lolice/provider.tf`はenv認証。`tfaction-root.yaml`の`terraform/tailscale/**`に対するTerraform plan/apply、tfmigrate plan/applyで`TAILSCALE_API_KEY`と`TAILSCALE_TAILNET`を注入する。`test.yaml` → `wc-test.yaml` → `wc-plan.yaml`がsecretを受け渡す。GitHubにSecret名`TAILSCALE_API_KEY`の登録を確認済み | 値・実利用・発行者・実有効期限は未確認。API keyを細粒度scope付きcredentialとみなさない |
| 今後のTailscale Terraform生成元 / API key | `templates/tailscale/provider.tf`もAPI key envに言及 | テンプレート自体はactive consumerではない。将来の移行時に設定伝播も確認する |
| lolice Kubernetes Operator / OAuth | `terraform/tailscale/lolice/oauth.tf`は手動作成とSSM SecureString保存を指定。コメントの最小権限はauth_keys・devices write、tag:k8s-operator。値はplaceholder、`ignore_changes = [value]`。SSMタグはProject/Purposeのみ | Operator実version・実scope・実client・最終利用・SSMとSecretの同期は未確認。コメントは付与済み権限の証明ではない。expiry metadataなし |
| lolice subnet router / auth key | `auth_key.tf`はreusable、ephemeral、preauthorized、tag:subnet-router。SSM SecureStringへ保存 | 実keyのactive状態・expiry・再登録時の消費経路は未確認。Terraformにexpiry指定なし。ephemeralはauth keyの期限管理の代わりではない |
| boxp/lolice ArgoCD diff / 既存WIF | `wif.tf`と`variables.tf`にGitHub issuer、boxp/lolice pull_request subject、workflow名ArgoCD Diff Check、auth_keys・devices:core、tag:ciを定義 | 定義がapply済みか、workflowが利用中か、実claim・scope一致は未確認。arch用のTrust Credentialとして流用しない |

実inventoryを確定する際は管理画面のcredential一覧metadataのみを使い、consumerの論理名、種別、owner、scope/tag、発行・期限・最終利用日時、確認日時を記録する。値、token、Secret本文、Terraform state、private endpointを開かない。metadata取得APIが本文に機密情報を含む場合は生レスポンスをログに出さず、許可された日時・状態だけを扱う。確認できないexpiryを推測せず`unknown`とし、当日owner調査対象にする。

## GitHub Actions / Terraform WIFのbootstrap

[公式WIF](https://tailscale.com/docs/features/workload-identity-federation)のTrust CredentialをownerがTailscale Adminで作成する。candidateは`.github/workflows/tailscale-wif-plan.yaml`の手動dispatch専用とし、main以外では実行しない。

Trust条件は次の完全一致を設定する。workflow名だけへの照合やrepository全体への許可に緩めない。

| 条件 | 値 |
| --- | --- |
| issuer | `https://token.actions.githubusercontent.com` |
| subject | `repo:boxp/arch:ref:refs/heads/main` |
| custom claim: repository | `boxp/arch` |
| custom claim: ref | `refs/heads/main` |
| custom claim: event_name | `workflow_dispatch` |
| custom claim: workflow_ref | `boxp/arch/.github/workflows/tailscale-wif-plan.yaml@refs/heads/main` |
| audience | ownerがTrust Credentialに設定する専用audienceとGitHub変数の値を一致させる |

GitHub repository variablesへ`TAILSCALE_WIF_PLAN_CLIENT_ID`と`TAILSCALE_WIF_PLAN_AUDIENCE`を登録する。これらは非secret設定であり、credential値の貼り付け先ではない。candidateには`TAILSCALE_API_KEY`、OAuth secret、その他既存secretを渡さない。candidateにはGitHub Environment protectionを設定していないため、main以外を拒否するworkflow条件と上記Trust条件が境界である。今後environmentによる承認を採用する場合はsubjectの変化も含めて別レビューする。

初期scope候補は`policy_file:read`、`devices:core:read`、`devices:posture_attributes:read`、`auth_keys:read`、`federated_keys:read`に限定する。既存federated identityのmetadata refreshにはOAuth metadataと別のread scopeが必要なため、Operator OAuth clientを管理していないこのmoduleに`oauth_keys:read`を追加しない。`dns.tf`にはTailscale DNS resourceがないため`dns:read`も付与しない。auth key metadata取得にAdminがtagを要求する場合のみtag:subnet-routerを使用し、tag:ciやOperatorのwrite権限を混ぜない。scopeの意味・依存は[Trust credentials公式一覧](https://tailscale.com/docs/reference/trust-credentials)を照合する。既存keyや既存federated identityのrefresh可否は未検証であり、不足scopeが判明した場合は失敗として止める。追加read scopeやtag可視性の要件を別レビューし、`all`やwriteへ自動拡張しない。

[provider v0.29.2の公式定義](https://github.com/tailscale/terraform-provider-tailscale/blob/v0.29.2/docs/index.md)ではGitHub実行環境からOIDC tokenを取得できる。candidateは`id-token: write`と`TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_AUDIENCE`を使うnative discoveryを採用する。`TAILSCALE_API_KEY`、`TAILSCALE_OAUTH_CLIENT_SECRET`、`TAILSCALE_IDENTITY_TOKEN`は空にして既存環境からの混入を避け、audience discoveryだけを使う。JWTを手動取得してファイルやjob outputに保存しない。API keyとの競合やsecretへのfallbackを許可しない。

bootstrap・切替の検証順序は次の通り。

1. PRをレビューし、candidateと保護条件をmainへ反映する。ownerがTrust条件・scope・tagを確認してAdmin側credentialを作成し、非secret変数を登録する。旧keyは維持する。
2. mainの手動dispatchでcandidateを実行する。OIDC交換、read-only API operation、対象`terraform/tailscale/lolice`のplanが成功することを確認する。`terraform plan`のstdout/stderrは`/dev/null`へ破棄し、exit codeのみ扱う。exit code 0と2はplan成功、1は失敗。plan出力・state・JSON・ログfile・artifactを作成／公開しない。planにはSSM値等が入り得るため、コメント投稿も禁止する。
3. 成功証跡はrun URL、main commit SHA、実行日時、pass/failとexit code、利用した設定versionのみ残す。JWT/APIレスポンス/plan本文を証跡に含めない。candidate失敗時はclaim、audience、scopeの設定差を値の露出なしで確認し、旧CIを継続する。
4. 既存production CIの移行は別のreviewable変更として作成する。PR用plan、main apply、tfmigrate各用途の必要scopeとclaimを分け、applyのwrite権限をcandidateへ付与しない。PR/fork実行では信頼していないコードへcredentialを渡す設計を避け、承認・checkout対象を具体化する。
5. 全consumerについてWIF切替後のread-only検証、Terraform plan、対象production CIの成功を確認する。単一candidate成功を全consumer移行の証拠にしない。旧keyを参照するworkflow・tfaction設定・テンプレート・手動利用が残っていないことをownerがmetadataベースで確認する。
6. 復旧経路と担当を確認した後、旧keyをrevokeし、旧secret参照を削除する。revoke後も新経路のplan・対象CIを再実行する。未達の検証はNotesへ未達と記録する。

revoke前の障害時は旧経路へ戻す変更をrevertし、既存keyによるCIを継続する。候補Trust Credentialを使うjobを止め、原因修正まで権限を拡張しない。revoke後に旧keyは復活できないため、ownerが限定consumer向けの新しい復旧credentialを安全なsecret経路で発行するか、Trust設定を修正する。機密値をNotes・PR・CLI引数・shell historyに貼らない。復旧成功後、復旧用credentialも検証してからrevokeする。

## Operator WIFの前提と分離判断

Operator WIFは今回は実装しない。[公式Operator WIF手順](https://tailscale.com/docs/kubernetes-operator/manage-and-configure/workload-identity-federation)は公開到達可能なOIDC discoveryを前提とする。archのkubeadm templateにissuer/JWKSの明示overrideはなく、Operator Deployment・ServiceAccount定義も本repoにはない。これは実クラスタの非対応を断定する材料ではなく、次の検証が未実施であるというblockerである。

| 前提 | 現状 / ownerが必要な証跡 |
| --- | --- |
| issuer | 実ServiceAccount tokenのissuerとdiscoveryのissuer一致を未確認。token本文やprivate URLを記録せず一致／不一致のみ記録 |
| discovery・JWKS | Tailscale側相当のクラスタ外経路から認証なしで取得できること、TLS検証とJWKSの鍵更新に追従することを未確認 |
| audience | projected tokenとTrustのaudienceの対応を未確認。GitHub用audienceを流用せず実versionの公式手順に従う |
| subject | 実namespace/ServiceAccountからsubjectを確定する。公式例の`system:serviceaccount:tailscale:operator`は実配置の証明ではない |
| rollout | Operator version、必要scope/tag、SSM/External Secrets消費経路、既存OAuthへのrollbackを未確認 |

公開discovery用RBAC・ネットワーク変更、Secret更新、OAuth client削除は今回行わない。owner boxpはクラスタ検証・公開可否の別ticketを作り、対象と影響、rollbackを明記して検討する。それまでOAuthのrotation運用を継続する。未確認のままWIF有効化済みと記載しない。

## 残存credentialのmetadataと期限監視

owner boxpが値を含まない台帳を維持する。項目はconsumer論理名、credential種別、owner、scope/tag、created_at、expires_at、last_used_at、last_verified_at、rotation_due_at、移行状態、関連ticket、旧／新経路の検証状態。生credential IDの貼り付けを必要とせず、管理画面で対応できる論理名を使う。期限不明は`unknown`として当日調査し、無期限と解釈しない。

API key/auth keyは実expiry metadataを確認して期限Tを決める。[OAuth clientの公式仕様](https://tailscale.com/docs/features/oauth-clients)ではclient secretは固有の有効期限がないため、架空のexpiryを設定せず`expires_at: not-applicable`と明記する。別途組織のrotation方針から`rotation_due_at`を設定する（このrunbookの初期運用は90日ごとの権限・利用確認）。サービスの実metadataに期限が存在する場合はその期限を優先する。短期access tokenの期限とOAuth client secretのrotation日を混同しない。

| 時点 | 手動運用（owner boxp） |
| --- | --- |
| 登録時 / 毎週 | active・expiry metadata・last usedを確認。unknownの解消、WIF化可能性、不要consumerと過剰scopeをレビュー |
| T-30 | 期限またはrotation_due_atの30日前にrotation ticketを起票。consumer、最小scope/tag、切替対象、影響、二重保持期間、検証点、rollback担当を記載 |
| T-7 | 未完了なら高優先度へ引き上げ、ownerが実施日時を確定。旧keyが新経路の検証完了まで有効であることをmetadataで確認 |
| T当日 / 失効検知時 | 自動延命を前提にしない。影響consumerを停止／復旧し、限定credentialまたはWIF設定修正を適用。検証とcleanupまでticketで追跡 |

T-30/T-7は実期限・rotation_due_atのそれぞれからUTC日付で算出する。既にT-30/T-7を過ぎているcredentialは次周期を待たず当日処理する。既存ログを見る場合もcredentialやprivate endpointを含む本文をNotesへ転記しない。

## 二重切替・検証・revoke

1. consumerを特定し、必要操作だけのscope/tagを新credentialへ設定する。Operatorは実versionの要件を確認し、`oauth.tf`のコメントだけでscope充足を判断しない。API keyからの最小権限化は可能な場合にtrust credentialへ移す。旧credentialは有効なまま残す。
2. 新旧を別の管理枠で保持する。OAuthは旧clientを保持して新clientを作成し、SSMの更新で旧secretを復元できる管理済みversionを残す。auth keyは旧keyを保持して新keyを発行する。実値は担当ownerが承認されたsecret store内で扱い、ticketには切替済み／未済のみ残す。
3. 新経路へ限定consumerを切り替える。OAuthのSSM client ID/secretは対応する組を揃え、External Secrets同期完了後にOperatorを段階的に再起動する。auth keyは既存Podが動くことだけでなく、新keyによる再登録・再起動を確認する。auth key失効と既存deviceのnode key期限は別に確認する。
4. read-only API、Operator healthとreconcile、subnet routerの新規登録、該当CIをconsumer別に検証する。失敗時は旧store version／旧clientの組へ戻し、同期とhealthを確認する。未検証ならrevokeしない。
5. 全切替先とrollback期間をownerが確認し、旧credentialの最終利用metadataを調べてからrevokeする。old client/keyの削除が既存nodeの継続利用を保証するとはみなさない。revoke後の新規認証を再検証し、台帳とticketの状態を更新する。
6. revoke後の復旧は旧credentialを再利用せず、最小権限の新credential発行またはWIF修正で行う。復旧credentialの削除予定もticketへ記載する。

subnet router auth keyはTerraform管理下にあり、SSM値やkey resourceの更新はapplyを伴う。本PRはrotationのapplyやSecret更新を行わない。metadata運用だけを追加して値の管理責任をTerraformと手作業で二重化しない。

## 通知の実配備状況

このタスクではRecurring Eventを作成していない。`docs/project_docs/BOXP-73-recurring-events/plan.md`にevaluatorとdisabled dry-runの設計があるが、それだけでは稼働中環境のevaluator・cron実配備の証明にならない。本runでは実配備とdry-run candidateを未確認であり、自動通知済みと主張しない。

当面はowner boxpの毎週metadata確認と、期限確定時の手動T-30/T-7 ticketを代替運用にする。cron導入を別途行う場合は、実環境のevaluator起動可否、同vaultを読むscheduler、job enabled状態、次回実行時刻、dry-runで期待するticket candidateと重複抑止を確認してから有効化する。dry-runは本番secretにアクセスせずexpiry metadataのみを使う。

## 次に必要な完了証跡

- ownerによるactive credentialと実expiry/scope/tagのmetadata棚卸し。
- Admin bootstrapと非secretGitHub variables設定、mainでのcandidate WIF plan成功run。
- consumer別production CI移行PRと成功run、旧key参照撤去、検証後revoke。
- Operatorの別ticketでのOIDC公開要件判断と検証。未充足ならOAuth運用継続。
- 手動期限運用のowner確認。自動化する場合だけ実配備・dry-run candidate証跡を追加。

credential値、token、state、plan本文、Secret本文、private endpointを完了証跡に含めない。
