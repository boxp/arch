# BOXP-200: WIF準備と残存credentialのrotation runbook

## 現在の到達点

2026-10-01時点の段階は次の通り。旧API keyは、段階4の検証が終わるまでrevokeしない。

| 段階 | 内容 | 状態 |
| --- | --- | --- |
| 1 | read-only Trustのbootstrapと、main限定の手動dispatchによるWIF plan | 完了（[run 36833143596](https://github.com/boxp/arch/actions/runs/36833143596)、変更なしで成功） |
| 2 | 本番CI用Trust（plan用read-only、apply用write）の作成と、変数で切り替わるworkflowの反映 | このPR。merge後のapplyは従来のAPI key経路で動く |
| 3 | ownerが非secretのclient IDを変数へ登録し、PRのplanとmainのapplyをWIFで成功させる | 未実施 |
| 4 | API keyの参照を削除するPR、API keyのrevoke、revoke後の再検証 | 未実施 |

担当ownerはboxp。以下の棚卸しはリポジトリの設定とGitHub登録metadataを根拠にした利用主体一覧である。GitHubにはSecret名`TAILSCALE_API_KEY`と`TAILSCALE_TAILNET`、変数名`TAILSCALE_WIF_PLAN_CLIENT_ID`と`TAILSCALE_WIF_PLAN_AUDIENCE`の登録がある。Environmentは未登録である。Secretの値は閲覧していない。実際にactiveなcredentialの全数・最終利用日時・有効期限・実scopeは、値を表示しないTailscale管理画面のmetadata確認が未実施のため未確定である。登録が存在することと現在利用中であることを区別する。

## 値を扱わないソース棚卸し

| 利用主体 / 種別 | 確認できた設定と根拠 | active / scope / expiryの未確認点 |
| --- | --- | --- |
| boxp/arch Terraform・tfmigrate / API key | `terraform/tailscale/lolice/provider.tf`はenv認証。`apply.yaml`と`wc-plan.yaml`がtfactionの`secrets`入力へ渡したSecretが、名前のまま環境変数としてterraformへ届く（詳細は「本番CIのWIF切替」）。`test.yaml` → `wc-test.yaml` → `wc-plan.yaml`がsecretを受け渡す。GitHubにSecret名`TAILSCALE_API_KEY`の登録を確認済み | 値・発行者・実有効期限は未確認。API keyを細粒度scope付きcredentialとみなさない。WIF切替の完了後にrevokeする |
| 今後のTailscale Terraform生成元 / API key | `templates/tailscale/provider.tf`もAPI key envに言及 | テンプレート自体はactive consumerではない。将来の移行時に設定伝播も確認する |
| lolice Kubernetes Operator / OAuth | `terraform/tailscale/lolice/oauth.tf`は手動作成とSSM SecureString保存を指定。コメントの最小権限はauth_keys・devices write、tag:k8s-operator。値はplaceholder、`ignore_changes = [value]`。Operatorはnamespace `tailscale-operator`でv1.80.3が稼働（2026-10-01、Deploymentのmetadataで確認） | 実scope・実client・最終利用・SSMとSecretの同期は未確認。コメントは付与済み権限の証明ではない。固有のexpiryはなく、四半期の棚卸しで確認する。WIF化の判断はBOXP-206 |
| lolice subnet router / auth key | `auth_key.tf`はreusable、ephemeral、preauthorized、tag:subnet-router。SSM SecureStringへ保存。2026-10-01のapplyで再発行された（PRのplan要約で確認） | 期限は発行から90日（provider既定）で、2026-12-30頃。実値はoutput `subnet_router_auth_key_expires_at`で確認する。再登録時の消費経路は未確認。ephemeralはauth keyの期限管理の代わりではない |
| boxp/lolice ArgoCD diff / 既存WIF | `wif.tf`と`variables.tf`にGitHub issuer、boxp/lolice pull_request subject、workflow名ArgoCD Diff Check、auth_keys・devices:core、tag:ciを定義 | 定義がapply済みか、workflowが利用中か、実claim・scope一致は未確認。arch用のTrust Credentialとして流用しない |

実inventoryを確定する際は管理画面のcredential一覧metadataのみを使い、consumerの論理名、種別、owner、scope/tag、発行・期限・最終利用日時、確認日時を記録する。値、token、Secret本文、Terraform state、private endpointを開かない。metadata取得APIが本文に機密情報を含む場合は生レスポンスをログに出さず、許可された日時・状態だけを扱う。確認できないexpiryを推測せず`unknown`とし、当日owner調査対象にする。

## GitHub Actions / Terraform WIFのbootstrap

[公式WIF](https://tailscale.com/docs/features/workload-identity-federation)のTrust Credentialを、既存認証でTerraformから先に作成する。認証に使うTerraform provider設定と、Tailscale側に作成する`tailscale_federated_identity`リソースは別物である。client IDとaudienceは作成後に確定するため、未作成のWIFをbootstrap自身の認証には使えない。candidateは`.github/workflows/tailscale-wif-plan.yaml`の手動dispatch専用とし、main以外では実行しない。

Trust条件は次の完全一致を設定する。workflow名だけへの照合やrepository全体への許可に緩めない。

| 条件 | 値 |
| --- | --- |
| issuer | `https://token.actions.githubusercontent.com` |
| subject | `repo:boxp/arch:ref:refs/heads/main` |
| custom claim: repository | `boxp/arch` |
| custom claim: ref | `refs/heads/main` |
| custom claim: event_name | `workflow_dispatch` |
| custom claim: workflow_ref | `boxp/arch/.github/workflows/tailscale-wif-plan.yaml@refs/heads/main` |
| audience | Tailscaleが作成時に生成する専用audienceを個別outputからGitHub変数へ登録する |

### Terraformによる初回作成と非secret設定の受け渡し

`wif.tf`の`tailscale_federated_identity.github_actions_arch_plan`がarch専用Trustである。既存の`github_actions_argocd_diff`はboxp/lolice用なので使用しない。[provider v0.29.2のresource仕様](https://github.com/tailscale/terraform-provider-tailscale/blob/v0.29.2/docs/resources/federated_identity.md)に従い、audienceは指定せずTailscaleによる生成値を使う。read scopeと`tag:subnet-router`だけを付与し、タグ登録済みACLへの依存を定義する。

1. ownerがレビュー済みmainのコードで、既存API keyとAWS backend認証を安全な実行環境から供給する。値を表示・CLI引数へ記載しない。この時点でproviderをWIF専用へ切り替えず、旧keyもrevokeしない。
2. bootstrapは`terraform plan -target=tailscale_federated_identity.github_actions_arch_plan -input=false -lock-timeout=60s`、確認後は同targetの`terraform apply`を使う。一時的なbootstrapに限定したtarget操作であり、通常の継続運用に使わない。依存ACLが含まれるため、対象Trustの追加と承認済み依存以外に変更があれば停止する。module全体のapplyはauth key再発行やSSM更新を巻き込む可能性があるので禁止する。plan/applyの診断も安全な実行環境内だけで扱い、ログ・artifact・PR・Notesへ転記しない。state/Secret本文は閲覧しない。
3. 作成後に`terraform output -raw arch_plan_wif_client_id`と`terraform output -raw arch_plan_wif_audience`だけを個別に取得する。引数なしの`terraform output`、`terraform output -json`、state pull/showは使わない。非secretの2項目をそれぞれ同名の用途のGitHub repository variablesへ登録する。
4. 管理画面で作成済みなら二重作成せず、ownerがresourceへimportして定義を照合する。importはstate変更を伴うため安全な実行環境で行い、生出力を共有しない。
5. apply失敗・変数登録失敗時はcandidateを実行せず旧認証を維持する。作成済みTrustは誤って再作成せずmetadataだけで確認する。不要となったTrustの削除は対象resourceのみを別途レビューし、module全体のdestroyを使わない。初回作成成功はWIF認証成功の証拠ではない。

GitHub repository variablesへ`TAILSCALE_WIF_PLAN_CLIENT_ID`と`TAILSCALE_WIF_PLAN_AUDIENCE`を登録する。これらは非secret設定であり、credential値の貼り付け先ではない。candidateには`TAILSCALE_API_KEY`、OAuth secret、その他既存secretを渡さない。candidateにはGitHub Environment protectionを設定していないため、main以外を拒否するworkflow条件と上記Trust条件が境界である。今後environmentによる承認を採用する場合はsubjectの変化も含めて別レビューする。

初期scope候補は`policy_file:read`、`devices:core:read`、`devices:posture_attributes:read`、`auth_keys:read`、`federated_keys:read`に限定する。既存federated identityのmetadata refreshにはOAuth metadataと別のread scopeが必要なため、Operator OAuth clientを管理していないこのmoduleに`oauth_keys:read`を追加しない。`dns.tf`にはTailscale DNS resourceがないため`dns:read`も付与しない。auth key metadata取得にAdminがtagを要求する場合のみtag:subnet-routerを使用し、tag:ciやOperatorのwrite権限を混ぜない。scopeの意味・依存は[Trust credentials公式一覧](https://tailscale.com/docs/reference/trust-credentials)を照合する。既存keyや既存federated identityのrefresh可否は未検証であり、不足scopeが判明した場合は失敗として止める。追加read scopeやtag可視性の要件を別レビューし、`all`やwriteへ自動拡張しない。

[provider v0.29.2の公式定義](https://github.com/tailscale/terraform-provider-tailscale/blob/v0.29.2/docs/index.md)ではGitHub実行環境からOIDC tokenを取得できる。candidateは`id-token: write`と`TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_AUDIENCE`を使うnative discoveryを採用する。`TAILSCALE_API_KEY`、`TAILSCALE_OAUTH_CLIENT_SECRET`、`TAILSCALE_IDENTITY_TOKEN`は空にして既存環境からの混入を避け、audience discoveryだけを使う。JWTを手動取得してファイルやjob outputに保存しない。API keyとの競合やsecretへのfallbackを許可しない。

bootstrap・切替の検証順序は次の通り。

1. PRをレビューし、candidateとTrust resourceをmainへ反映する。上記Terraform bootstrapでTrustを作成し、個別outputから非secret変数を登録する。旧keyは維持する。
2. mainの手動dispatchでcandidateを実行する。OIDC交換、read-only API operation、対象`terraform/tailscale/lolice`のplanが成功することを確認する。`terraform plan`のstdout/stderrは`/dev/null`へ破棄し、exit codeのみ扱う。exit code 0と2はplan成功、1は失敗。plan出力・state・JSON・ログfile・artifactを作成／公開しない。planにはSSM値等が入り得るため、コメント投稿も禁止する。
3. 成功証跡はrun URL、main commit SHA、実行日時、pass/failとexit code、利用した設定versionのみ残す。JWT/APIレスポンス/plan本文を証跡に含めない。candidate失敗時はclaim、audience、scopeの設定差を値の露出なしで確認し、旧CIを継続する。
4. 既存production CIの移行は別のreviewable変更として作成する。PR用plan、main apply、tfmigrate各用途の必要scopeとclaimを分け、applyのwrite権限をcandidateへ付与しない。PR/fork実行では信頼していないコードへcredentialを渡す設計を避け、承認・checkout対象を具体化する。
5. 全consumerについてWIF切替後のread-only検証、Terraform plan、対象production CIの成功を確認する。単一candidate成功を全consumer移行の証拠にしない。旧keyを参照するworkflow・tfaction設定・テンプレート・手動利用が残っていないことをownerがmetadataベースで確認する。
6. 復旧経路と担当を確認した後、旧keyをrevokeし、旧secret参照を削除する。revoke後も新経路のplan・対象CIを再実行する。未達の検証はNotesへ未達と記録する。

revoke前の障害時は旧経路へ戻す変更をrevertし、既存keyによるCIを継続する。候補Trust Credentialを使うjobを止め、原因修正まで権限を拡張しない。revoke後に旧keyは復活できないため、ownerが限定consumer向けの新しい復旧credentialを安全なsecret経路で発行するか、Trust設定を修正する。機密値をNotes・PR・CLI引数・shell historyに貼らない。復旧成功後、復旧用credentialも検証してからrevokeする。

## 本番CI（tfaction）のWIF切替

### 認証がterraformへ届く経路

`suzuki-shunsuke/tfaction` v2.3.2の`terraform-init` / `plan` / `apply`は、`secrets`入力のJSONを「環境変数名 → 値」としてそのままterraformのprocessへ渡す。これまでAPI keyが届いていたのは、Secret名`TAILSCALE_API_KEY`がproviderの環境変数名と同じだからである。`tfaction-root.yaml`の`secrets`対応表は`output-github-secrets` actionを使う場合だけ参照されるため、現行workflowでは使われていない。

`apply.yaml`は`toJSON(secrets)`を渡しており、Tailscale以外の対象でもrepositoryの全Secretがterraformのprocessへ渡っている。これは今回の変更範囲外の既存挙動で、別ticketでの是正を提案する。WIFモードのTailscale対象では`{}`を渡すので、この露出はなくなる。

### Trust Credentialと変数

| 用途 | resource | scope / tag | 追加のclaim条件 | 変数 |
| --- | --- | --- | --- | --- |
| 手動の検証 | `github_actions_arch_plan` | read-only / `tag:subnet-router` | `event_name=workflow_dispatch`、`workflow_ref`は`tailscale-wif-plan.yaml` | `TAILSCALE_WIF_PLAN_CLIENT_ID`、`TAILSCALE_WIF_PLAN_AUDIENCE` |
| PRのplan・tfmigrate plan | `github_actions_arch_ci_plan` | read-only（手動検証と同じ5 scope）/ `tag:subnet-router` | `event_name=pull_request_target`、`workflow_ref`は`test.yaml`、`job_workflow_ref`は`wc-plan.yaml` | `TAILSCALE_WIF_CI_PLAN_CLIENT_ID` |
| mainのapply・tfmigrate apply | `github_actions_arch_apply` | `policy_file`、`devices:core:read`、`devices:posture_attributes`、`auth_keys`、`federated_keys` / `tag:subnet-router`、`tag:ci` | `event_name=push`、`workflow_ref`は`apply.yaml` | `TAILSCALE_WIF_APPLY_CLIENT_ID` |

3つともissuerはGitHub Actions、`repository=boxp/arch`を条件にする。手動検証用とapply用は、subjectを`repo:boxp/arch:ref:refs/heads/main`、`ref`を`refs/heads/main`に固定する。plan用だけはsubjectを`repo:boxp/arch:*`とし、`ref`を条件にしない。`pull_request_target`で発行されるtokenの`sub`と`ref`の形式をGitHubが文書化しておらず、実tokenで確認できていないためである。代わりに`event_name`と、`@refs/heads/main`まで含めた`workflow_ref`・`job_workflow_ref`で限定する。`pull_request_target`はbase branchのworkflowで動くため、PR側でworkflowを書き換えてもこの条件は満たせない。mainでないbaseへのPRは`workflow_ref`が一致しない。一方でPRのTerraformコードはplan中に実行されるので、plan用のTrustはread-onlyに限定する。API keyをPRのplanへ渡していた従来より権限は小さくなる。

apply用のscopeは、このmoduleが管理するresource（ACL、auth key、Trust Credential）に対応する。`policy_file`には`devices:core:read`と`devices:posture_attributes`が必要という[公式のscope一覧](https://tailscale.com/docs/reference/trust-credentials)に従った。`tag:ci`は`github_actions_argocd_diff`が付与するtagである。apply用Trustは`devices:core`のwriteを持たない。`github_actions_argocd_diff`（`devices:core`を付与する）を作り直す変更が権限不足で失敗した場合は、自動でscopeを広げず、変更内容をレビューした上で一時的な権限追加か管理画面での操作を選ぶ。

audienceの変数は不要である。Tailscaleが生成するaudienceは`api.tailscale.com/<client ID>`の形式で（[公式WIF](https://tailscale.com/docs/features/workload-identity-federation)）、workflowがclient IDから組み立てる。登録済みの`TAILSCALE_WIF_PLAN_*`でこの形式と一致することを確認した。

### workflowの切替条件

`wc-plan.yaml`と`apply.yaml`は、対象が`terraform/tailscale/`配下で、かつ対応する変数が空でないときだけWIFモードになる。

| モード | terraformへ渡る認証 |
| --- | --- |
| 変数なし（従来） | `toJSON(secrets)`経由の`TAILSCALE_API_KEY`と`TAILSCALE_TAILNET`。`TAILSCALE_OAUTH_CLIENT_ID`と`TAILSCALE_AUDIENCE`は空 |
| 変数あり（WIF） | `TAILSCALE_OAUTH_CLIENT_ID`と`TAILSCALE_AUDIENCE`。`secrets`は`{}`なのでAPI keyは渡らない。tailnetは認証主体から決まる |

providerは空文字の環境変数を未設定として扱う（v0.29.2の`Configure`を確認）。両方が設定された場合は`Provider credentials error`で失敗し、黙って片方を使うことはない。

### 切替手順（owner）

1. このPRをmergeする。applyは従来のAPI key経路で動き、Trustを2つ作成する。PRのplanが「Trust 2つの追加とoutputの追加」だけであることをmerge前に確認する。auth keyやSSMの変更が含まれていたら止める。
2. client IDを取得する。applyコメントのOutputs、Tailscale管理画面のTrust credentials、または`terraform output -raw arch_ci_plan_wif_client_id` / `arch_apply_wif_client_id`のいずれかを使う。client IDは非secretである。引数なしの`terraform output`やstateの表示は使わない。
3. `gh variable set TAILSCALE_WIF_CI_PLAN_CLIENT_ID --repo boxp/arch`で登録する。`terraform/tailscale/lolice`のコメントだけを変えるPRを作り、planの成功を確認する。plan jobのログ冒頭の`env:`で`TAILSCALE_OAUTH_CLIENT_ID`が空でないことがWIFモードの証跡になる。
4. `gh variable set TAILSCALE_WIF_APPLY_CLIENT_ID --repo boxp/arch`で登録し、手順3のPRをmergeしてapplyの成功を確認する。
5. API keyの参照を削除するPRを作る。対象は`test.yaml` / `wc-test.yaml` / `wc-plan.yaml`の`TAILSCALE_API_KEY`受け渡し、`tfaction-root.yaml`の`TAILSCALE_API_KEY`対応、`templates/tailscale/provider.tf`のコメント、workflowの従来モードへの分岐。このPRのplanとapplyがWIFで成功することを確認する。
6. Tailscale管理画面でAPI keyの最終利用日時が手順3より前で止まっていることを確認してからrevokeし、GitHubのSecret `TAILSCALE_API_KEY`を削除する。手動dispatchのWIF planと、任意のPRのplanを再実行して成功を確認する。

失敗時の復旧:

| 時点 | 復旧 |
| --- | --- |
| 手順3・4で失敗（revoke前） | `gh variable delete`で該当変数を消すと次の実行からAPI key経路へ戻る。コードのrevertは不要。失敗の原因はclaim・scopeの設定差として調べ、scopeを`all`へ広げない |
| 手順5のmerge後、revoke前 | PRをrevertし、変数を消す |
| revoke後 | 旧keyは復活できない。管理画面でTrustの条件を直すか、期限の短い復旧用API keyを発行してSecretへ登録し、変数を消して従来モードで直す。復旧後にそのkeyもrevokeする |

apply用Trustは自分自身をこのmoduleで管理している。`github_actions_arch_apply`のclaim条件やscopeを変えるPRは、apply後に次のapplyが通らなくなる可能性があるため、管理画面から直せる状態で行う。

## Operator WIFの前提と分離判断

Operator WIFは実装しない。[公式Operator WIF手順](https://tailscale.com/docs/kubernetes-operator/manage-and-configure/workload-identity-federation)は公開到達可能なOIDC discoveryを前提とするが、2026-10-01のread-only確認で前提を満たさないと分かった。判断と設計はBOXP-206へ分離した。

| 前提 | 確認結果（2026-10-01） |
| --- | --- |
| issuer | クラスタのOIDC discoveryが返すissuerはkubeadm既定の`https://kubernetes.default.svc.cluster.local`。クラスタ外から名前解決も到達もできない |
| discovery・JWKS | JWKSの参照先はクラスタ内部アドレス（値は記録しない）。公開経路はない |
| subject | Operatorはnamespace `tailscale-operator`、ServiceAccount `operator`。subjectは`system:serviceaccount:tailscale-operator:operator`になる |
| Operator version | image `tailscale/k8s-operator:v1.80.3`。WIF対応versionへの更新要否はBOXP-206で確認する |
| audience・rollout | 未検証。公開issuerが決まってから設計する |

確認はdiscovery文書のissuerとDeploymentのmetadataだけで行い、ServiceAccount tokenやSecretは読んでいない。issuerの変更はkube-apiserverの設定変更で、既存のServiceAccount token利用者すべてに影響する。公開discovery用のRBAC・ネットワーク変更、Secret更新、OAuth client削除は行っていない。BOXP-206で可否が決まるまでOAuth clientの運用を続ける。

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

Recurring Eventsのevaluatorとcronは配備済みである。2026-10-01に次を確認した。

- evaluator: `/opt/codex-workspace/recurring-events/recurring_events.bb`が存在し、dry-runが動く。
- cron: `recurring-events-apply`がenabledで、毎日08:00 JSTに実行される。直近の実行は2026-10-01 08:00 JST。

vaultの`Infrastructure/Recurring Events/Events/`へ次の3イベントを作成した。

| イベント | 起票条件 | dry-runで確認したcandidate |
| --- | --- | --- |
| `tailscale-subnet-router-auth-key-rotation` | auth keyの期限（2026-12-30）の30日前 | `--today 2026-11-30`でcandidate |
| `tailscale-subnet-router-auth-key-rotation-final-check` | 同じ期限の7日前 | `--today 2026-12-23`でcandidate |
| `tailscale-credential-review` | 四半期の初日の7日前。期限を持たないOAuth clientなどの棚卸し | `--today 2026-12-25`で2027-01-01分がcandidate |

現在日のdry-runでは、auth keyの2イベントは`not-yet`である。`tailscale-credential-review`の2026-10-01分は当日だけcandidateになるが、次のcron実行は翌日なので起票されない。今回の棚卸しはBOXP-200で代替し、初回の自動起票は2027-01-01分になる。

auth keyの期限は2026-12-30（UTC）である。PR #13077のplanが表示したoutput `subnet_router_auth_key_expires_at`で確認した。rotationのたびに次の期限をoccurrenceへ追加する必要があり、起票されるticketのAcceptance Criteriaに含めた。

## 次に必要な完了証跡

- ownerによる「切替手順」の3〜6（変数登録、WIFでのplanとapplyの成功run、API key参照の削除、revoke、revoke後の再検証）。
- ownerによるactive credentialと実expiry/scope/tagのmetadata棚卸し。
- BOXP-206でのOperator WIFの可否判断。決まるまでOAuth運用を続ける。
- `apply.yaml`が全Secretをterraformへ渡している既存挙動の是正（別ticketの提案）。

credential値、token、state、plan本文、Secret本文、private endpointを完了証跡に含めない。

## 2026-09-30 再調査の証跡

- PR #13019はOpenで、candidate workflowはmain未配備、WIF repository variablesは未設定（値の取得なし）。
- 既存API key経路の後続[CI run 36674011555](https://github.com/boxp/arch/actions/runs/36674011555)はsetup/対象planとも成功（job結果metadataで確認）。前回のsetup失敗は現在の継続blockerではない。この成功はWIF成功を証明しない。
- 本runはTerraform bootstrap定義の追加まで。実apply・Trust作成・変数登録・実WIF plan・旧key revokeは未実施。Operator公開OIDC条件も未検証。

## 2026-10-01 の証跡

- PR #13019は2026-10-01にmerge済み。直後の[apply run 36816838549](https://github.com/boxp/arch/actions/runs/36816838549)はplan fileの読み込みに失敗し、tfactionが作成したfollow-up PR #13065の[apply run 36831463437](https://github.com/boxp/arch/actions/runs/36831463437)が成功した。PRのplan要約によると、このapplyはTrustの作成に加えてsubnet router auth keyの再発行とSSM parameterの更新を含む。旧keyが無効になっていたため、providerの既定動作で再作成された。
- 変数`TAILSCALE_WIF_PLAN_CLIENT_ID`と`TAILSCALE_WIF_PLAN_AUDIENCE`の登録を名前で確認した。
- [手動dispatch run 36833143596](https://github.com/boxp/arch/actions/runs/36833143596)（main `66fc04a0e`）は全step成功で、結果は`WIF read-only plan succeeded: no changes.`。API keyを渡さないjobで実stateをrefreshするplanが通ったので、read-onlyの5 scopeでこのmoduleのplanができることを確認できた。
- 確認はjobとstepの結果、workflowが出力する固定文言、PRコメントの要約行だけで行った。plan本文、state、Secretは取得していない。
