# argocd-api.b0xp.io 実装設計書

## 重要な注意点

### バリデーションエラー解決（2024年XX月XX日追加）

以下のTerraformバリデーションエラーが発生したため、Accessトークン設定を修正しました：

```
Error: Unsupported argument
  on access.tf line 50, in resource "cloudflare_access_service_token" "github_action_token":
  50:   triggers = {
An argument named "triggers" is not expected here.
```

`cloudflare_access_service_token`リソースでは`triggers`パラメータは使用できないため、代わりに`lifecycle`ブロック内の`replace_triggered_by`を使用してトークンローテーションを実装するよう設計を変更しました。この修正により、同等の機能を維持しながらバリデーションエラーを解消しています。

### TFLintエラー解決（2024年XX月XX日追加）

また、以下のTFLintエラーが発生したため、追加の修正が必要です：

```
WARNING access.tf 27 ... 27 Missing version constraint for provider "time" in required_providers
```

`time_rotating`リソースを使用しているため、`terraform.required_providers`ブロック内に`time`プロバイダーのバージョン制約を追加する必要があります。具体的には、`backend.tf`ファイルを以下のように修正する必要があります：

```hcl
terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/argocd/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 4.52.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.7.1"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.10.0"
    }
  }
}
```

この修正により、Terraformに`time`プロバイダーのバージョンを明示的に指定し、TFLintのエラーを解消します。

## 1. 目的

本プロジェクトの目的は、lolice Kubernetesクラスター上のArgo CD APIをGitHub Actionからアクセス可能にし、PRプロセスでのManifestの差分表示を自動化することです。これにより、コード変更のレビュープロセスが改善され、デプロイの安全性と効率が向上します。

## 2. 設計概要

### 2.1 アーキテクチャ

以下のアーキテクチャを実装します：

```
GitHub Action ⟷ Cloudflare Access ⟷ Cloudflare Tunnel ⟷ cloudflared Pod ⟷ Argo CD Server
```

1. GitHub ActionはCloudflare Accessのサービストークンを使用して認証
2. リクエストはCloudflare Tunnelを経由してクラスターに到達
3. クラスター内のcloudflared PodがArgo CD Serverにリクエストを転送
4. Argo CD ServerはKubernetes API経由でマニフェストの差分情報を取得
5. 結果はGitHub ActionへのレスポンスとしてPRコメントに表示

### 2.2 コンポーネント一覧

- **Cloudflare DNS**: `argocd-api.b0xp.io`ドメインの設定
- **Cloudflare Tunnel**: クラスターへの安全なアクセス経路
- **Cloudflare Access**: GitHub Actionのみに限定したアクセス制御
- **AWS SSM Parameter Store**: シークレット管理
- **Kubernetes ExternalSecret**: AWSからKubernetesへのシークレット転送
- **cloudflared Deployment**: Tunnelの接続エンドポイント
- **NetworkPolicy**: クラスター内の通信制限
- **Argo CD Service Account & RBAC**: APIアクセス用の権限設定
- **GitHub Action Workflow**: PR時の差分表示自動化

## 3. 実装詳細

### 3.1 Terraformコードの実装

#### 3.1.1 DNS設定 (`arch/terraform/cloudflare/b0xp.io/argocd/dns.tf`)

```hcl
# 既存のargoCDレコードに加えて、API用のレコードを追加
resource "cloudflare_record" "argocd_api" {
  zone_id = var.zone_id
  name    = "argocd-api"
  value   = cloudflare_tunnel.argocd_api_tunnel.cname
  type    = "CNAME"
  proxied = true
}
```

#### 3.1.2 Tunnel設定 (`arch/terraform/cloudflare/b0xp.io/argocd/tunnel.tf`)

```hcl
# API用のトンネルを作成
resource "cloudflare_tunnel" "argocd_api_tunnel" {
  account_id = var.account_id
  name       = "cloudflare argocd-api tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# トンネル設定
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

# トンネルトークンをSSMに保存
resource "aws_ssm_parameter" "argocd_api_tunnel_token" {
  name        = "argocd-api-tunnel-token"
  description = "for argocd-api tunnel token"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.argocd_api_tunnel.tunnel_token)
}
```

#### 3.1.3 Access設定 (`arch/terraform/cloudflare/b0xp.io/argocd/access.tf`)

```hcl
# API用のアクセスアプリケーション
resource "cloudflare_access_application" "argocd_api" {
  zone_id          = var.zone_id
  name             = "Access application for argocd-api.b0xp.io"
  domain           = "argocd-api.b0xp.io"
  session_duration = "24h"
}

# GitHub Action用のサービストークン
resource "cloudflare_access_service_token" "github_action_token" {
  account_id = var.account_id
  name       = "GitHub Action - ArgoCD API"
  min_days_for_renewal = 30
  
  # トークンローテーション設定
  lifecycle {
    create_before_destroy = true
    replace_triggered_by = [
      time_rotating.token_rotation.id
    ]
  }
}

# サービストークンによるアクセスを許可するポリシー
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

# トークンIDをSSMに保存
resource "aws_ssm_parameter" "github_action_token" {
  name        = "argocd-api-github-action-token"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_action_token.client_id)
}

# トークンシークレットをSSMに保存
resource "aws_ssm_parameter" "github_action_secret" {
  name        = "argocd-api-github-action-secret"
  description = "for GitHub Action to access ArgoCD API"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_action_token.client_secret)
}

# トークンローテーション設定
resource "time_rotating" "token_rotation" {
  rotation_days = 90
}
```

### 3.2 Kubernetesマニフェストの実装

#### 3.2.1 RBAC設定 (`lolice/argoproj/argocd/base/github-actions-rbac.yaml`)

```yaml
# GitHub Action用のサービスアカウント
apiVersion: v1
kind: ServiceAccount
metadata:
  name: github-actions-sa
  namespace: argocd
---
# 読み取り専用権限を持つロール
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
# サービスアカウントへのロール紐付け
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

#### 3.2.2 ExternalSecret定義 (`lolice/argoproj/argocd/base/external-secrets.yaml`)

```yaml
# トンネルトークン取得用のExternalSecret
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: argocd-api-tunnel-es
  namespace: argocd
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: argocd-api-tunnel-credentials
    creationPolicy: Owner
  data:
  - secretKey: tunnel-token
    remoteRef:
      conversionStrategy: Default
      decodingStrategy: None
      key: argocd-api-tunnel-token
      metadataPolicy: None
```

#### 3.2.3 cloudflared Deployment (`lolice/argoproj/argocd/base/cloudflared-api.yaml`)

```yaml
# cloudflared実行用のDeployment
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
                name: argocd-api-tunnel-credentials
                key: tunnel-token
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
```

#### 3.2.4 NetworkPolicy設定 (`lolice/argoproj/argocd/base/network-policy.yaml`)

```yaml
# API通信用のネットワークポリシー
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

### 3.3 GitHub Action Workflow

#### 3.3.1 差分確認ワークフロー (`lolice/.github/workflows/argocd-diff.yaml`)

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

## 4. 実装手順

実装作業は以下の順序で行います：

### 4.1 Terraform実装とデプロイ

1. `arch/terraform/cloudflare/b0xp.io/argocd/dns.tf`を編集してDNSレコードを追加
2. `arch/terraform/cloudflare/b0xp.io/argocd/tunnel.tf`を編集してTunnel設定を追加
3. `arch/terraform/cloudflare/b0xp.io/argocd/access.tf`を編集してAccess設定を追加
4. `arch/terraform/cloudflare/b0xp.io/argocd/backend.tf`を編集してtimeプロバイダーを追加:
   ```bash
   vim arch/terraform/cloudflare/b0xp.io/argocd/backend.tf
   ```
   以下を`required_providers`ブロックに追加:
   ```hcl
   time = {
     source  = "hashicorp/time"
     version = "~> 0.10.0"
   }
   ```
5. `time_rotating`リソースを使用するため、GitHub Actionのプロバイダーホワイトリストに`time`プロバイダーを追加:
   ```bash
   vim arch/.github/workflows/wc-plan.yaml
   ```
   以下の行を追加:
   ```yaml
   TFPROVIDERCHECK_CONFIG_BODY: |
     providers:
       - name: registry.terraform.io/cloudflare/cloudflare
       - name: registry.terraform.io/hashicorp/aws
       - name: registry.terraform.io/hashicorp/google
       - name: registry.terraform.io/hashicorp/null
       - name: registry.terraform.io/hashicorp/tls
       - name: registry.terraform.io/hashicorp/random
       - name: registry.terraform.io/hashicorp/time  # トークンローテーション用
       - name: registry.terraform.io/integrations/github
   ```
6. Terraformコードを適用:
   ```bash
   cd arch/terraform/cloudflare/b0xp.io/argocd
   terraform init
   terraform plan -out=plan.out
   terraform apply plan.out
   ```