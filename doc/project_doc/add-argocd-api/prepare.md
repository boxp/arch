# argocd-api.b0xp.io ホスティング準備

## 概要

このドキュメントでは、lolice k8sクラスターに既存のArgo CD APIをGitHub Actionのみがアクセスできるように公開するための準備情報をまとめています。これにより、GitHub CI/CDパイプラインからArgo CDのdiff結果を表示させることが可能になります。

## 1. Argo CD APIの概要

Argo CDは、Kubernetesのアプリケーション管理のためのGitOpsツールであり、REST APIを提供しています。このAPIを使用することで、アプリケーションの状態確認、同期、diff取得などの操作を外部から実行できます。

### 1.1 Argo CD API機能

Argo CD APIは以下の主要な機能を提供しています：

- アプリケーション管理（作成、更新、削除）
- アプリケーションの状態取得
- アプリケーションの同期
- アプリケーションのdiff取得（GitリポジトリとKubernetes実際の状態の差分）
- リソースツリーの取得
- Argo CDのシステム設定管理

### 1.2 API利用のためのエンドポイント

Argo CDのAPI公式ドキュメントによると、主なエンドポイントは以下のとおりです：

- アプリケーションのdiff取得: `/api/v1/applications/{name}/manifests`
- アプリケーションの同期: `/api/v1/applications/{name}/sync`
- アプリケーションの状態取得: `/api/v1/applications/{name}`

## 2. Cloudflare上でのホスティング設定

### 2.1 DNSレコードの作成

Cloudflareの`b0xp.io`ドメイン内に`argocd-api.b0xp.io`サブドメインを作成します。これはCloudflare Tunnelのレコードを指し示すCNAMEレコードとして設定します。

参考実装：
```hcl
resource "cloudflare_record" "argocd_api" {
  zone_id = var.zone_id
  name    = "argocd-api"
  value   = cloudflare_tunnel.argocd_api_tunnel.cname
  type    = "CNAME"
  proxied = true
}
```

### 2.2 Cloudflare Tunnelの設定

K8sクラスターへの接続はCloudflare Tunnelを使用して行います。これにより外部からの直接アクセスを遮断しながら、Cloudflareを経由したセキュアなアクセスが可能になります。

参考実装：
```hcl
resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_tunnel" "argocd_api_tunnel" {
  account_id = var.account_id
  name       = "cloudflare argocd-api tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

resource "cloudflare_tunnel_config" "argocd_api_tunnel" {
  tunnel_id  = cloudflare_tunnel.argocd_api_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      hostname = cloudflare_record.argocd_api.hostname
      service  = "http://argocd-server.argocd.svc.cluster.local:80"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# トークンをAWS Systems Managerパラメータストアに保存
resource "aws_ssm_parameter" "argocd_api_tunnel_token" {
  name        = "argocd-api-tunnel-token"
  description = "for argocd-api tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.argocd_api_tunnel.tunnel_token)
}
```

### 2.3 cloudflaredの設定

Cloudflare Tunnelを実際に利用するには、Kubernetes内にcloudflaredを実行するDeploymentが必要です。外部シークレットからトークンを取得してTunnelに接続します。

#### 2.3.1 ExternalSecret定義

AWS SSM ParameterにあるTunnelトークンをKubernetes Secretに取得します。

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: external-secret
  namespace: argocd
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: tunnel-credentials
    creationPolicy: Owner
  data:
  - secretKey: tunnel-token
    remoteRef:
      conversionStrategy: Default	
      decodingStrategy: None	
      key: argocd-api-tunnel-token
      metadataPolicy: None
```

#### 2.3.2 cloudflared Deployment定義

トークンをマウントしてCloudflare Tunnelを実行します。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared-api
  namespace: argocd
spec:
  selector:
    matchLabels:
      app: cloudflared-api
  replicas: 1
  template:
    metadata:
      labels:
        app: cloudflared-api
    spec:
      containers:
      - name: cloudflared
        image: docker.io/cloudflare/cloudflared:latest
        ports:
          - name: metrics
            containerPort: 2000
        args:
        - tunnel
        - --metrics
        - 0.0.0.0:2000
        livenessProbe:
          httpGet:
            path: /ready
            port: 2000
          failureThreshold: 1
          initialDelaySeconds: 10
          periodSeconds: 10
        env:
          - name: TUNNEL_TOKEN
            valueFrom:
              secretKeyRef:
                name: tunnel-credentials
                key: tunnel-token
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
```

## 3. GitHub Action用のアクセス管理

### 3.1 Cloudflare Accessによる認証設定

Cloudflare Accessを使用して、GitHub Actionのみがアクセスできるように認証を設定します。GitHub Actionは、事前に発行したAPIトークンを使用してアクセスします。

参考実装：
```hcl
resource "cloudflare_access_application" "argocd_api" {
  zone_id          = var.zone_id
  name             = "Access application for argocd-api.b0xp.io"
  domain           = "argocd-api.b0xp.io"
  session_duration = "24h"
}

resource "cloudflare_access_service_token" "github_action_token" {
  account_id = var.account_id
  name       = "GitHub Action - ArgoCD API"
  min_days_for_renewal = 30
}

resource "cloudflare_access_policy" "argocd_api_policy" {
  application_id = cloudflare_access_application.argocd_api.id
  zone_id        = var.zone_id
  name           = "GitHub Actions access policy for argocd-api.b0xp.io"
  precedence     = "1"
  decision       = "allow"
  include {
    service_token = [cloudflare_access_service_token.github_action_token.id]
  }
}

# GItHub ActionのトークンをAWS Systems Managerパラメータストアに保存
resource "aws_ssm_parameter" "github_action_token" {
  name        = "argocd-api-github-action-token"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_action_token.client_id)
}

resource "aws_ssm_parameter" "github_action_secret" {
  name        = "argocd-api-github-action-secret"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_action_token.client_secret)
}
```

### 3.2 GitHub Secretの設定

GitHub Actionがアクセスするために必要なシークレットを、GitHubリポジトリのシークレットとして保存します。これにより、GitHub Actionワークフローからこれらの値を安全に参照できます。

AWS Systems Manager Parameter Storeから値を取得し、GitHubリポジトリのシークレットとして設定します：

1. `ARGOCD_API_TOKEN_ID` - Cloudflare Accessサービストークンのclient_id
2. `ARGOCD_API_TOKEN_SECRET` - Cloudflare Accessサービストークンのclient_secret
3. `ARGOCD_SERVER_URL` - `https://argocd-api.b0xp.io`

### 3.3 Argo CDのサービスアカウント設定

GitHub Actionが使用するための専用サービスアカウントをArgo CD内に作成します。

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: github-actions-sa
  namespace: argocd
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: github-actions-role
  namespace: argocd
rules:
- apiGroups:
  - argoproj.io
  resources:
  - applications
  verbs:
  - get
  - list
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: github-actions-rolebinding
  namespace: argocd
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: github-actions-role
subjects:
- kind: ServiceAccount
  name: github-actions-sa
  namespace: argocd
```

### 3.4 Argo CDのAPIトークン生成

GitHub Actionのための永続的なAPIトークンを生成します。以下のコマンドを実行して、サービスアカウント用のトークンを作成します：

```bash
argocd proj role create-token default github-actions-role
```

または、Argo CD APIを使用して生成することもできます：

```bash
curl -X POST -H "Authorization: Bearer $ARGOCD_AUTH_TOKEN" \
  -d '{"id":"github-actions","name":"github-actions-role","policies":["p, proj:default:github-actions-role, applications, get, default/*, allow"]}' \
  https://argocd.b0xp.io/api/v1/projects/default/roles
```

生成されたトークンを取得して、AWS Systems Manager Parameter Storeに保存します：

```hcl
resource "aws_ssm_parameter" "argocd_api_token" {
  name        = "argocd-api-token-for-github-action"
  description = "Argo CD API token for GitHub Action"
  type        = "SecureString"
  value       = var.argocd_api_token  # 事前に生成したトークンを変数として渡す
}
```

次に、このトークンをGitHubリポジトリのシークレットとして設定します：
- `ARGOCD_AUTH_TOKEN` - Argo CD APIトークン

## 4. GitHub Actionワークフローの実装

### 4.1 差分確認ワークフローの例

以下は、GitHub ActionでArgo CD APIを使用してアプリケーションの差分を確認するワークフローの例です：

```yaml
name: ArgoCD Diff Check

on:
  pull_request:
    branches: [ main ]
    paths:
      - 'argoproj/**'

jobs:
  argocd-diff:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Get modified applications
        id: get-apps
        run: |
          CHANGED_APPS=$(find argoproj -type f -name "*.yaml" -o -name "*.yml" | grep -v "kustomization" | awk -F/ '{print $2}' | sort | uniq)
          echo "apps=$CHANGED_APPS" >> $GITHUB_OUTPUT
      
      - name: Get ArgoCD diff
        env:
          ARGOCD_SERVER: ${{ secrets.ARGOCD_SERVER_URL }}
          ARGOCD_AUTH_TOKEN: ${{ secrets.ARGOCD_AUTH_TOKEN }}
          CF_ACCESS_CLIENT_ID: ${{ secrets.ARGOCD_API_TOKEN_ID }}
          CF_ACCESS_CLIENT_SECRET: ${{ secrets.ARGOCD_API_TOKEN_SECRET }}
        run: |
          for APP in ${{ steps.get-apps.outputs.apps }}; do
            echo "### アプリケーション: $APP の差分" >> diff_output.md
            echo '```diff' >> diff_output.md
            
            # Cloudflare Access認証ヘッダーを使用してArgo CD APIにアクセスする
            DIFF_OUTPUT=$(curl -s -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
                          -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
                          -H "Authorization: Bearer $ARGOCD_AUTH_TOKEN" \
                          "$ARGOCD_SERVER/api/v1/applications/$APP/manifests" | jq -r '.')
            
            if [ -z "$DIFF_OUTPUT" ]; then
              echo "No diff found or error occurred" >> diff_output.md
            else
              echo "$DIFF_OUTPUT" >> diff_output.md
            fi
            
            echo '```' >> diff_output.md
            echo "" >> diff_output.md
          done
          
      - name: Comment PR
        uses: actions/github-script@v6
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const diffOutput = fs.readFileSync('diff_output.md', 'utf8');
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## ArgoCD Diff Result\n${diffOutput}`
            });
```

## 5. セキュリティ考慮事項

### 5.1 トークンのローテーション

セキュリティのベストプラクティスとして、Argo CDのAPIトークンとCloudflare Accessサービストークンは定期的にローテーションすることをお勧めします。Terraformを使用して自動化することも可能です。

```hcl
resource "time_rotating" "token_rotation" {
  rotation_days = 90  # 90日ごとにローテーション
}

resource "cloudflare_access_service_token" "github_action_token" {
  account_id = var.account_id
  name       = "GitHub Action - ArgoCD API"
  min_days_for_renewal = 30
  
  # time_rotatingリソースが変更されるたびに新しいトークンを生成
  lifecycle {
    create_before_destroy = true
  }
  
  triggers = {
    rotation = time_rotating.token_rotation.id
  }
}
```

### 5.2 最小権限の原則

GitHub Actionに付与する権限は、必要最小限に制限します。Argo CDのサービスアカウントには、読み取り専用の権限のみを割り当て、特定のアプリケーションやプロジェクトのみにアクセスできるように制限します。

### 5.3 ネットワークポリシー

Kubernetes内でNetworkPolicyを使用して、Argo CDサーバーへのアクセスを制限します。cloudflaredからのアクセスのみを許可するポリシーを設定します。

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: argocd-server-policy
  namespace: argocd
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: argocd-server
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: cloudflared-api
    ports:
    - protocol: TCP
      port: 80
```

## 6. 実装手順

1. Terraformを使用してCloudflare DNS、Tunnel、Accessの設定を作成します。
2. AWS Systems Manager Parameter Storeに必要なシークレットを保存します。
3. Kubernetes上に必要なリソース（ExternalSecret、cloudflared Deployment、NetworkPolicy）を作成します。
4. Argo CD内にGitHub Action用のサービスアカウントとロールを作成します。
5. Argo CD APIトークンを生成し、Parameter Storeに保存します。
6. AWS Systems Manager Parameter Storeの値をGitHubリポジトリのシークレットとして設定します。
7. GitHub Actionワークフローを作成して、PR時に差分を表示するようにします。
8. テスト環境でワークフローをテストし、正常に動作することを確認します。
9. 定期的なトークンのローテーションスケジュールを設定します。

## 7. 参考リソース

- [Argo CD API Documentation](https://argo-cd.readthedocs.io/en/stable/developer-guide/api-docs/)
- [Cloudflare Access Service Tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [GitHub Actions - Secrets and Variables](https://docs.github.com/ja/actions/security-guides/encrypted-secrets)
- [Argo CD RBAC Configuration](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)

## 8. 実装ファイルパス

このセクションでは、前述した各コンポーネントを実装するために編集または作成する必要があるファイルパスを示します。

### 8.1 Terraformコード（arch project）

Cloudflare DNS、Tunnel、Accessの設定などのTerraformコードは以下のファイルに実装します：

- **Cloudflare DNS設定**: `arch/terraform/cloudflare/b0xp.io/argocd/dns.tf`
  - 既存ファイルに`cloudflare_record "argocd_api"`リソースを追加

- **Cloudflare Tunnel設定**: `arch/terraform/cloudflare/b0xp.io/argocd/tunnel.tf`
  - 既存ファイルに`cloudflare_tunnel "argocd_api_tunnel"`、`cloudflare_tunnel_config "argocd_api_tunnel"`、`aws_ssm_parameter "argocd_api_tunnel_token"`リソースを追加

- **Cloudflare Access設定**: `arch/terraform/cloudflare/b0xp.io/argocd/access.tf`
  - 既存ファイルに`cloudflare_access_application "argocd_api"`、`cloudflare_access_service_token "github_action_token"`、`cloudflare_access_policy "argocd_api_policy"`、関連するAWS SSMパラメータリソースを追加

- **AWS SSM Parameter Store設定**: `arch/terraform/cloudflare/b0xp.io/argocd/access.tf`
  - Argo CD APIトークンのためのSSMパラメータを追加（トークン生成後）

### 8.2 Kubernetesマニフェスト（lolice project）

Kubernetes上のリソース定義は以下のファイルに実装します：

- **namespace、ServiceAccount、Role、RoleBinding**:
  `lolice/argoproj/argocd/base/github-actions-rbac.yaml`

- **ExternalSecret定義**:
  `lolice/argoproj/argocd/base/external-secrets.yaml`

- **cloudflared Deployment定義**:
  `lolice/argoproj/argocd/base/cloudflared-api.yaml`

- **NetworkPolicy定義**:
  `lolice/argoproj/argocd/base/network-policy.yaml`

### 8.3 GitHub Actionワークフロー

GitHub Actionのワークフロー定義は以下のファイルに実装します：

- **差分確認ワークフロー**:
  `lolice/.github/workflows/argocd-diff.yaml`
