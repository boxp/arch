# BOXP-206 Tailscale Kubernetes OperatorのWIF化 計画

## 目的と現在の到達点

lolice clusterのTailscale Operatorを、OAuth client secretからWorkload Identity Federation（WIF）へ移行できるかを判断し、進める場合の方式・影響・rollbackを決める。

2026-10-01時点の状態は次の通り。

| 項目 | 状態 |
| --- | --- |
| Operator更新（chart 1.80.3 → 1.102.4） | [boxp/lolice#809](https://github.com/boxp/lolice/pull/809) を作成済み。未merge。WIFの判断と独立 |
| ownerの判断（案Aで進める / 案CでOAuth継続） | 未決定 |
| 公開issuerのホスト名と配信方式 | 未決定（案Aの場合に必要） |
| kube-apiserverのissuer変更、Trust Credential、Operatorの認証切替 | 未着手。ownerの判断後に行う |

この文書の手順のうち、段階1以降は実機で未検証である。未確認の点は「未確認事項」にまとめる。

## 前提（2026-10-01のread-only確認）

- Kubernetes v1.36.1、control plane 3台（kubeadm、静的Pod）。
- kube-apiserverの `--service-account-issuer` はkubeadm既定の `https://kubernetes.default.svc.cluster.local` の1つだけ。`--service-account-jwks-uri` と `--api-audiences` は未指定。
- discovery文書とJWKSは認証済みのServiceAccountだけが取得できる（ClusterRoleBinding `system:service-account-issuer-discovery` のsubjectは `system:serviceaccounts`）。クラスタ外からは到達できない。
- Operatorはnamespace `tailscale-operator`、ServiceAccount `operator`。管理対象は `argocd/argocd-server` Serviceのexpose（hostname `lolice-argocd`）の1件。
- Tailscale公式の[Operator WIF手順](https://tailscale.com/docs/kubernetes-operator/manage-and-configure/workload-identity-federation)は、クラスタのOIDC discovery endpointが公開到達可能であることを要求する。WIF対応はOperator v1.92から。v1.98.3には正しいJWTが拒否される不具合があり、v1.98.4で修正されている（[tailscale/tailscale#19919](https://github.com/tailscale/tailscale/issues/19919)）。

## 公開issuerの提供方式

### 比較

| 案 | 内容 | 外部に出るもの | 鍵rotation追従 | 評価 |
| --- | --- | --- | --- | --- |
| A（推奨） | discovery文書とJWKSの2ファイルを公開HTTPSの静的ホストへ置き、そのURLをissuerにする。kube-apiserverは公開しない | SA署名鍵の公開鍵と鍵ID、issuer URL | 手動 | apiserverへの未認証到達を増やさない |
| B | apiserverの2 pathをCloudflare Tunnel等で限定公開し、`system:unauthenticated` にdiscovery権限を付与する | 上記に加え、apiserverへのインターネットからの経路 | 自動 | path制限の設定ミスがapiserver露出に直結する。非推奨 |
| C | 公開しない。OAuth client運用を続ける | なし | 該当なし | 変更なし。BOXP-200 runbookの四半期棚卸しを続ける |

### 案Aの仕様

公開issuer URLを `https://<公開ホスト名>` とする（ホスト名はownerが決める）。

公開する情報は次の2 pathだけとする。

| path | 内容 |
| --- | --- |
| `/.well-known/openid-configuration` | `issuer` と `jwks_uri` を公開URLに書き換えたdiscovery文書 |
| `/openid/v1/jwks` | SA署名鍵の公開鍵（JWKS） |

- 未認証で到達できる範囲はこの2 pathのGETだけにする。それ以外のpathは404を返す。
- kube-apiserverが現在返すdiscovery文書の `jwks_uri` はクラスタ内部アドレスなので、そのまま公開しない。
- JWKSに含まれるのは公開鍵と鍵IDで、秘密鍵（`sa.key`）は含まれない。公開ファイルは `kubectl get --raw /openid/v1/jwks` の出力から作り、control planeの鍵ファイルを直接読まない。
- 静的ホストは既存の慣例（`terraform/cloudflare/b0xp.io/` 配下、またはAWS）に合わせてTerraformで管理する。配信方式はホスト名と合わせてownerが決める。
- `--service-account-jwks-uri` を公開JWKSのURLに設定し、apiserverが返すdiscovery文書と公開文書を一致させる。

### 鍵rotationへの追従

- SA署名鍵はkubeadmの `sa.key` / `sa.pub`。kubeadmは証明書更新時もこの鍵をrotationしないので、JWKSが変わるのは手動rotation時だけである。
- 公開JWKSが古いと、WIFのtoken exchangeだけが失敗する。クラスタ内の認証には影響しない。
- 鍵をrotationするときは、旧鍵と新鍵の両方を検証できる期間を挟む。旧鍵をすぐ外すと、旧鍵で署名済みのtokenがクラスタ内の認証でもWIFのtoken exchangeでも拒否される。次の順序で行い、BOXP-200 runbookへ追記する。
  1. 新しい鍵ペアを作る。全control planeのkube-apiserverで `--service-account-key-file` を旧公開鍵と新公開鍵の2つにする（1台ずつ）。署名鍵（`--service-account-signing-key-file`）はまだ旧鍵のままにする。
  2. 公開JWKSを旧公開鍵と新公開鍵の両方を含む内容に更新する。クラスタのJWKS（`kubectl get --raw /openid/v1/jwks`）と鍵IDの集合が一致することを確認する。
  3. 全control planeで署名鍵を新鍵へ切り替える（1台ずつ。kube-controller-managerの `--service-account-private-key-file` も同じ鍵にする）。手順1と2が全台・公開側で終わる前に切り替えない。
  4. 旧鍵で署名されたtokenが全て失効するまで、旧公開鍵をapiserverの `--service-account-key-file` と公開JWKSの両方に残す。projected tokenは既定で約1時間で更新されるが、延長有効期限（`--service-account-extend-token-expiration`、最長1年）を持つtokenと、期限の無いlegacyのSecret型tokenがある。旧鍵のtokenを使うworkloadが無いこと（Podの再作成、legacy tokenの再発行）を確認してから次へ進む。
  5. 旧公開鍵をapiserverから外し（1台ずつ）、その後に公開JWKSからも外す。
- 公開JWKSは、apiserverが検証に使う公開鍵の集合と常に同じか、それより広い状態を保つ。鍵を足すときは公開側が先、外すときは公開側が後になる。
- 公開JWKSとクラスタのJWKS（`kubectl get --raw /openid/v1/jwks`）の差分確認を、BOXP-200 runbookの四半期棚卸しへ追加する。

## issuer変更の影響

### 影響を受ける利用者

| 利用者 | 影響 |
| --- | --- |
| クラスタ内のclient-go利用者（ArgoCD、External Secrets、Operator等） | issuerを自前で検証しない。apiserverが旧issuerを受理し続ける限り影響しない |
| `codex-workspace` Pod（audienceに現行issuer URLを明示したprojected token） | `--api-audiences` に現行値を明示して固定すれば影響しない。段階1で実挙動を確認する |
| External Secretsの `parameterstore` | secretRef認証（IRSAではない）のためissuerに依存しない |
| legacyのSecret型SA token（issuer `kubernetes/serviceaccount`） | 対象外 |
| issuerを検証する外部consumer | 2026-10-01時点で見つかっていない |

### 変更の仕組み

- kube-apiserverは `--service-account-issuer` を複数指定できる。先頭が発行用で、指定した全てを検証で受理する（[Kubernetes公式](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/)）。
- control planeが3台あるため、1回の変更で先頭を差し替えると、更新済みノードが発行した新issuerのtokenを未更新ノードが拒否する。そのため2段階に分ける。
- `--api-audiences` は未指定だとissuerから導出される。issuerを増やすと既定audienceが変わる可能性があるので、段階1で現行値を明示して固定する。
- 変更はkube-apiserver静的Podの再起動を伴う。`ansible/playbooks/control-plane.yml` は `serial: 1` とetcd health gateを持つので、同じ経路で1台ずつ適用する。

### 値を揃える場所

`kubeadm upgrade` はkubeadm-configから静的Podを再生成する。次の3か所に同じ値を入れる。

1. 各control planeの `/etc/kubernetes/manifests/kube-apiserver.yaml`（稼働中の値）
2. `kube-system/kubeadm-config` ConfigMapの `apiServer.extraArgs`
3. `ansible/roles/kubernetes_components/templates/kubeadm-config.yaml.j2` の `apiServer.extraArgs`（v1beta4のname/valueリスト形式）

現在のansibleはetcdマニフェストだけを直接編集している。kube-apiserverマニフェストを編集するタスクは新規に追加する。

## 手順

### 0. owner判断

- 「Operator更新のみ」「案AでWIFまで進める」「案Cでclose」のいずれかを決め、ticketのNotesへ記録する。
- 案Aの場合、公開issuerのホスト名と配信方式を決める。

### 1. Operator更新（boxp/lolice。WIFと独立）

[boxp/lolice#809](https://github.com/boxp/lolice/pull/809) でchartを1.102.4へ更新する。認証はOAuthのまま変えない。

merge後に確認する。

- Application `tailscale-operator` がSynced/Healthy
- Operator Podのログに認証・reconcileエラーが無い
- `ts-argocd-server-*` が新imageで再作成されReady
- tailnet上の `lolice-argocd` が到達可能で、argocd-diffがTailscale経路で成功

失敗時はPRをrevertする。必要なら2026-07-05のincident時と同様に自動syncを一時停止する。その間argocd-diffはCloudflare経路へfallbackする。

### 2. 公開issuerの準備（案Aの場合）

1. 静的ホストをTerraformで作成し、2ファイルを配置する。
2. クラスタ外から未認証で2 pathが取得でき、他のpathが取得できないことを確認する。公開JWKSの鍵IDがクラスタのJWKSと一致することを確認する。

この時点ではクラスタに変更は無く、ホストを削除すれば元に戻る。

### 3. 段階1: 新issuerを受理一覧へ追加

全3台を次の設定にする。発行issuerは変わらない。

```
--service-account-issuer=https://kubernetes.default.svc.cluster.local
--service-account-issuer=https://<公開ホスト名>
--api-audiences=https://kubernetes.default.svc.cluster.local
```

1台ずつ適用し、各台で次を確認してから次の台へ進む。

- kube-apiserverがReadyへ復帰し、etcdがhealthy
- ArgoCD、External Secrets、`codex-workspace`、OperatorのログにAPI認証エラー（401）が無い
- ExternalSecretが `SecretSynced` のまま

3台完了後、kubeadm-config ConfigMapとansibleテンプレートへ同じ値を反映する。

### 4. 段階2: 発行issuerを切替

段階1の完了から時間を置き、健全性を確認してから行う。全3台を次の設定にする。

```
--service-account-issuer=https://<公開ホスト名>
--service-account-issuer=https://kubernetes.default.svc.cluster.local
--service-account-jwks-uri=https://<公開ホスト名>/openid/v1/jwks
--api-audiences=https://kubernetes.default.svc.cluster.local
```

1台ずつ適用し、段階1と同じ確認に加えて次を確認する。

- 新規に発行したtokenの `iss` が公開issuer URLである（tokenの中身は記録しない）
- apiserverが返すdiscovery文書と公開文書の `issuer` / `jwks_uri` が一致する
- 1時間以上経過してprojected tokenが更新された後も、各workloadが健全である

3台完了後、kubeadm-config ConfigMapとansibleテンプレートへ同じ値を反映する。

### 5. Trust Credentialと認証切替

1. `terraform/tailscale/lolice/wif.tf` に `tailscale_federated_identity` を追加する。

   | 項目 | 値 |
   | --- | --- |
   | issuer | `https://<公開ホスト名>` |
   | subject | `system:serviceaccount:tailscale-operator:operator` |
   | audience | 指定しない。Tailscaleが `api.tailscale.com/<client ID>` の形式で生成する。生成された値はresourceの `audience` 属性で、client IDは `id` 属性で読める |
   | scopes | `auth_keys`、`devices:core`、Services（管理画面の General/Services のwrite） |
   | tags | `tag:k8s-operator` |

   scopeは公式のOperator WIF手順が要求する3つ（General/Services、Devices/Core、Keys/Auth Keys のwrite）を初回から全て付与する。Services scopeを外した構成は公式にサポートされておらず、切替直後にexposeのreconcileが権限不足で失敗するおそれがあるため、推測で減らさない。ticketのACはscopeを `auth_keys`・`devices:core` としているが、公式要件に合わせてServicesを加える（ACとの差分としてownerの確認を受ける）。ServicesのAPI scope識別子は実装時にprovider文書と `terraform plan` で確定する。Services scopeを後から外すかどうかは、WIF切替が安定した後に別途検証して決める。
2. Trust Credentialのclient IDとaudienceを `terraform/tailscale/lolice/outputs.tf` のoutputにする（既存の `arch_plan_wif_audience` と同じ形。どちらも非secret）。apply後のoutputから実際の値を取得する。audienceの値を形式から手で組み立てない。
3. boxp/loliceの `helm/values.yaml` から `oauthSecretVolume` を外し、次の2つを設定する。chartは `oauthSecretVolume` があると `oauth.audience` を無視するので、OAuthとWIFは同時に使えない。`oauth.clientSecret` は設定しない（設定すると `oauth.audience` より優先される）。

   | key | 値 |
   | --- | --- |
   | `oauth.clientId` | 手順2のoutputのclient ID |
   | `oauth.audience` | 手順2のoutputのaudience（`api.tailscale.com/<client ID>` の形式）。Trust Credentialの `audience` 属性と完全一致させる |

   chartは `oauth.audience` を、Operator Podへmountするprojected ServiceAccount tokenの `audience` にそのまま使う。未設定だとchartはOAuth secretのmountへ戻り、値がTrust Credentialと違うとtoken exchangeが失敗する。
4. merge前に、audienceの一致を確認する。
   - `helm template` の出力で、Operator Deploymentに `oidc-jwt` のprojected volumeがあり、その `audience` が手順2のoutputと同じ文字列である
   - 同じ出力で、env `CLIENT_ID` が手順2のoutputのclient IDであり、`CLIENT_ID_FILE` / `CLIENT_SECRET_FILE` と `oauth` volumeが無い
   - `terraform plan` が差分なしで、Trust Credentialのissuer・subjectが段階2後のクラスタの値（公開issuer URL、`system:serviceaccount:tailscale-operator:operator`）と同じである
5. ExternalSecret、SSM parameter、OAuth client本体は残したまま切り替える。
6. merge後に確認する。
   - 稼働中のOperator Podのprojected volumeの `audience`（`kubectl get pod -o yaml` で読める。tokenの中身は読まない）が手順2のoutputと同じである
   - OperatorがWIFで起動し、ログに認証エラーが無い
   - Operatorを再起動しても再認証できる
   - expose対象の再reconcile（proxyの再作成または新規expose）が成功する
   - argocd-diffがTailscale経路で成功する

### 6. 後片付け

1. 数日の安定稼働後、ownerがTailscale管理画面でOAuth clientをrevokeする。revoke後にOperator再起動とreconcileを再確認する。
2. ExternalSecret `tailscale-operator-oauth`、SSM parameter 2つ、`oauth.tf` を削除する。
3. BOXP-200 runbookの利用主体一覧を更新し、鍵rotationの順序と公開JWKSの差分確認を追記する。lolice `docs/project_docs/T-20260301-012/runbook.md` のOAuth前提の記述も直す。

### 案Cの場合

BOXP-200 runbookに「Operator WIFは公開issuerを用意しない判断のため見送り。OAuth clientは四半期棚卸しを継続」と明記してcloseする。手順1（Operator更新）を行うかは別に決める。

## rollback

どの段階でも1つ前の状態へ戻せる。

| 失敗した段階 | 戻し方 |
| --- | --- |
| 手順1（Operator更新） | lolice PRをrevertする |
| 手順2（静的ホスト） | クラスタは未変更。ホストを残しても削除しても影響しない |
| 手順3（段階1） | 追加した `--service-account-issuer` と `--api-audiences` を1台ずつ外す。新issuerのtokenは発行されていないので、外しても拒否されるtokenは無い |
| 手順4（段階2） | 段階1の並び（旧issuerが先頭、新issuerが2番目）へ1台ずつ戻し、`--service-account-jwks-uri` を外す。新issuerは受理一覧に残す |
| 手順5（認証切替） | valuesのPRをrevertしてOAuth経路へ戻す。OAuth client・SSM・ExternalSecretを残しているので、戻すだけで復旧する |

段階2から戻すときの注意:

- 新issuerで発行されたtokenが残っている間は、新issuerを受理一覧から消さない。projected tokenは既定で約1時間ごとに更新されるが、延長有効期限を持つtokenがあるため、消す前に新issuerのtokenを使うworkloadが無いことを確認する。
- 戻す順序も1台ずつとし、各台で段階1と同じ健全性確認を行う。
- kubeadm-config ConfigMapとansibleテンプレートも稼働中の値に合わせて戻す。

OAuth clientをrevokeした後（手順6）はOAuth経路へ戻せない。revoke前に手順5の確認を全て終える。

## 未確認事項

- ServicesのAPI scope識別子（Terraform providerでの指定値）
- issuerを複数指定したときの既定audienceの実挙動（段階1で確認する）
- 22 minorを飛ばしたOperator更新の可否（公式に記載なし）
- Connector / ProxyGroup等のCRの有無（調査時の権限では一覧できなかった）
- 公開issuerのホスト名と配信方式

## secretの扱い

token、secret、Terraform state、private endpointをticket・PR・ログへ残さない。JWKSとclient IDは非secretだが、SA tokenの中身は記録しない。
