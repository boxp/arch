# argocd-api.b0xp.io 実装設計書

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
  }
  
  triggers = {
    rotation = time_rotating.token_rotation.id
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
        - run
        - --token
        - $(TUNNEL_TOKEN)
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
4. `time_rotating`リソースを使用するため、GitHub Actionのプロバイダーホワイトリストに`time`プロバイダーを追加:
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
5. Terraformコードを適用:
   ```bash
   cd arch/terraform/cloudflare/b0xp.io/argocd
   terraform init
   terraform plan -out=plan.out
   terraform apply plan.out
   ```

### 4.2 Argo CD API設定

1. Argo CDにログインし、GitHub Action用のサービスアカウントとロールを設定するためのトークンを生成:
   ```bash
   argocd proj role create-token default github-actions-role
   ```
   生成されたトークンはGitHubリポジトリのSecretsに直接設定します（後述の「4.4 GitHub Action設定」参照）。

### 4.3 Kubernetesマニフェスト適用

1. GitHub Actions RBAC設定を作成:
   ```bash
   mkdir -p lolice/argoproj/argocd/base/
   vim lolice/argoproj/argocd/base/github-actions-rbac.yaml
   ```
2. ExternalSecret定義を作成:
   ```bash
   vim lolice/argoproj/argocd/base/external-secrets.yaml
   ```
3. cloudflared Deployment定義を作成:
   ```bash
   vim lolice/argoproj/argocd/base/cloudflared-api.yaml
   ```
4. NetworkPolicy定義を作成:
   ```bash
   vim lolice/argoproj/argocd/base/network-policy.yaml
   ```
5. ArgoCD kustomization.yamlを更新して新しいマニフェストを含める:
   ```bash
   vim lolice/argoproj/argocd/kustomization.yaml
   ```
   以下のように追加したリソースを記述:
   ```yaml
   apiVersion: kustomize.config.k8s.io/v1beta1
   kind: Kustomization
   resources:
   - github.com/argoproj/argo-cd/manifests/base?ref=v2.14.4
   - cloudflared-deployment.yaml
   - external-secret.yaml
   - base/github-actions-rbac.yaml  # GitHub Action用RBAC
   - base/external-secrets.yaml     # API用トンネルトークン取得
   - base/cloudflared-api.yaml      # API用cloudflared
   - base/network-policy.yaml       # API用通信制限
   patchesStrategicMerge:
   - overlays/argocd-redis-network-policy.yaml
   - overlays/argocd-repo-server-network-policy.yaml
   - overlays/argocd-server-network-policy.yaml
   - overlays/argocd-cmd-params-cm.yaml
   - overlays/argocd-cm.yaml
   ```
6. 変更をリポジトリにプッシュし、ArgoCD経由でデプロイ

### 4.4 GitHub Action設定

1. GitHub Actionワークフロー定義を作成:
   ```bash
   mkdir -p lolice/.github/workflows/
   vim lolice/.github/workflows/argocd-diff.yaml
   ```
2. GitHubリポジトリのSecretsに必要な値を設定:
   - `ARGOCD_SERVER_URL`: `https://argocd-api.b0xp.io`
   - `ARGOCD_AUTH_TOKEN`: 前のステップ（4.2）で生成したArgo CD APIトークン
   - `ARGOCD_API_TOKEN_ID`: AWS SSM Parameter Storeに保存されたCloudflare Accessサービストークンのclient_id
   - `ARGOCD_API_TOKEN_SECRET`: AWS SSM Parameter Storeに保存されたCloudflare Accessサービストークンのclient_secret

## 5. テスト計画

実装完了後、以下のテストを実施します：

1. **cloudflared接続テスト**
   - cloudflaredポッドが正常に起動しているか確認
   - トンネル接続が確立されているか確認
   ```bash
   kubectl -n argocd get pods -l app=cloudflared-api
   kubectl -n argocd logs -l app=cloudflared-api
   ```

2. **Cloudflare Access認証テスト**
   - サービストークンを使用して手動でAPIリクエストを送信
   ```bash
   curl -H "CF-Access-Client-Id: ${CLIENT_ID}" \
        -H "CF-Access-Client-Secret: ${CLIENT_SECRET}" \
        https://argocd-api.b0xp.io/api/v1/applications
   ```

3. **GitHub Actionワークフローテスト**
   - テスト用のPull Requestを作成して、ワークフローが正常に実行されるか確認
   - PRコメントに差分情報が表示されるか確認

## 6. リスク管理

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| Cloudflare Accessトークンの漏洩 | 不正アクセスの可能性 | 90日ごとのトークン自動ローテーション、GitHub Secretsの適切な管理 |
| Argo CD APIトークンの漏洩 | APIへの不正アクセス | 最小権限の原則に基づく権限設定、定期的なトークンローテーション |
| cloudflaredの障害 | API接続不能 | ヘルスチェックの設定、監視と自動復旧機能の追加 |
| ネットワークポリシーの不備 | クラスター内の不正アクセス | 厳格なポリシーの定義と定期的なレビュー |
| GitHub Actionの障害 | 差分表示の失敗 | エラー処理の追加、通知設定 |

## 7. 運用計画

### 7.1 監視

- cloudflaredポッドのログ監視
- GitHub Actionの実行結果監視
- Cloudflare Tunnelの接続状態監視

### 7.2 メンテナンス

- 3ヶ月ごとのCloudflare Accessトークンローテーション（自動）
- 6ヶ月ごとのArgo CD APIトークンローテーション（手動）
- GitHubリポジトリSecretsの定期的な更新

### 7.3 インシデント対応

1. **アクセス障害時**:
   - cloudflaredログの確認
   - ポッドの再起動
   - Tunnel設定の確認と再適用

2. **GitHub Action失敗時**:
   - ワークフローログの確認
   - シークレットの有効性確認
   - 手動でのAPI疎通確認
