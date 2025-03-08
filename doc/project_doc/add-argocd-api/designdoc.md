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

`time_rotating`リソースを使用したため、`terraform.required_providers`ブロック内に`time`プロバイダーのバージョン制約を追加する必要があります。具体的には、`backend.tf`ファイルを以下のように修正する必要があります：

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

### kustomizeパス解決エラーの解決（2024年XX月XX日追加）

GitHub Action内でkustomizeを使用したdiff確認時に、以下のようなエラーが発生することがありました：

```
Error: must build at directory: not a valid directory: evalsymlink failure on 'argoproj/argocd-image-updater' : lstat /argoproj: no such file or directory
```

このエラーは、kustomizeが相対パスを絶対パスに解決しようとする際に、`argoproj/argocd-image-updater`を`/argoproj/argocd-image-updater`（ルートディレクトリからの絶対パス）として解釈してしまうことが原因です。GitHub Actionの実行環境では、作業ディレクトリがルートディレクトリではないため、このようなパス解決エラーが発生します。

この問題を解決するために、以下のように`argocd app diff`コマンドの実行方法を修正する必要があります：

1. 絶対パスを使用して`--local`オプションを指定する
2. ディレクトリを作業ディレクトリからの絶対パスとして構築する

具体的には、以下のように「Extract applications and check for changes」ステップを修正します：

```yaml
# Diffを取得
REPO_ROOT=$(pwd)
if ! argocd app diff "argocd/$APP_NAME" \
  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID,CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  --grpc-web \
  --insecure \
  --local-repo-root "$REPO_ROOT" \
  --local "$REPO_ROOT/$CURRENT_DIR" >> app_diff_results.md 2>&1; then
  echo "Error getting diff for $APP_NAME" >> app_diff_results.md
fi
```

この修正によって、kustomizeが作業ディレクトリからの正しい絶対パスを使用するようになり、パス解決エラーが解消されます。

### argocd app diffコマンドのexit code処理（2024年XX月XX日追加）

`argocd app diff`コマンドは特殊なexit codeを返すため、エラー処理を修正する必要があります。[公式ドキュメント](https://argo-cd.readthedocs.io/en/latest/user-guide/commands/argocd_app_diff/)によると、このコマンドは以下のexit codeを返します：

- 0: 差分なし
- 1: 差分あり（エラーではない）
- 2: 一般的なエラー

現在の実装では、非ゼロのexit codeをすべてエラーとして扱っていますが、exit code 1は実際には正常な状態（差分あり）を示します。また、GitHubアクションでは、ステップのexit codeが0以外の場合、CIが失敗として扱われるため、差分がある場合でもCIが失敗しないように修正が必要です。

最も重要な点は、`argocd app diff`コマンドの終了ステータスがそのままシェルスクリプトに伝播しないようにすることです。よって、以下のように「Extract applications and check for changes」ステップを修正します：

```yaml
# Diffを取得 - コマンドの終了ステータスがシェルに伝播しないようにする
REPO_ROOT=$(pwd)
set +e  # エラーが発生してもスクリプトを終了しないようにする
argocd app diff "argocd/$APP_NAME" \
  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID,CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  --grpc-web \
  --insecure \
  --local-repo-root "$REPO_ROOT" \
  --local "$REPO_ROOT/$CURRENT_DIR" >> app_diff_results.md 2>&1
DIFF_EXIT_CODE=$?
set -e  # エラー時にスクリプトを終了する設定に戻す

# exit codeに基づいて適切なメッセージを追加
if [ $DIFF_EXIT_CODE -eq 0 ]; then
  echo "✅ 差分なし" >> app_diff_results.md
elif [ $DIFF_EXIT_CODE -eq 1 ]; then
  echo "ℹ️ 上記の差分が見つかりました" >> app_diff_results.md
elif [ $DIFF_EXIT_CODE -eq 2 ]; then
  echo "❌ エラーが発生しました" >> app_diff_results.md
  # 本当のエラー（exit code 2）の場合のみ、ステップを失敗させる
  exit 1
fi
```

この修正により、`argocd app diff`コマンドのexit codeを正確に処理し、適切なメッセージをPRコメントに表示します。また、真のエラー（exit code 2）の場合のみCIジョブを失敗させ、単なる差分検出（exit code 1）の場合は成功として扱います。

`set +e`と`set -e`の設定により、`argocd app diff`コマンドの終了ステータスがスクリプト全体に伝播しなくなり、私たちが意図した通りの制御が可能になります。

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
      service  = "http://argocd-server:80"
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
  decision       = "non_identity"
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
    permissions:
      contents: write
      pull-requests: write
      repository-projects: write
      id-token: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0  # 完全な履歴を取得してdiffが正確に取れるようにする
      
      - name: Setup environment and ArgoCD CLI
        run: |
          # PRで変更されたファイルを取得
          git fetch origin main
          git diff --name-only origin/main..HEAD > changed_files.txt
          cat changed_files.txt
          
          # ArgoCD CLIのインストール
          curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
          sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd
          rm argocd-linux-amd64
          
          # kustomizeのインストール
          curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash
          sudo install -m 555 kustomize /usr/local/bin/kustomize
          rm kustomize
          
          # Helmのインストール
          curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
          chmod 700 get_helm.sh
          ./get_helm.sh
          rm get_helm.sh
      
      - name: Extract applications and check for changes
        id: get-apps
        env:
          ARGOCD_SERVER: "${{ vars.ARGOCD_SERVER_URL }}"
          ARGOCD_AUTH_TOKEN: "${{ secrets.ARGOCD_AUTH_TOKEN }}"
          CF_ACCESS_CLIENT_ID: "${{ secrets.ARGOCD_API_TOKEN_ID }}"
          CF_ACCESS_CLIENT_SECRET: "${{ secrets.ARGOCD_API_TOKEN_SECRET }}"
        run: |

          # application.yamlファイルを探し、アプリケーション名とパスのマッピングを作成
          echo "Finding all application.yaml files..."
          
          # 出力ファイルの初期化
          echo "" > app_diff_results.md
          
          # PRで変更されたファイルを含むディレクトリを特定
          CHANGED_DIRS=$(cat changed_files.txt | grep -E "^argoproj/" | xargs -I{} dirname {} | sort | uniq)
          
          # アプリケーション情報を収集
          declare -A APP_INFO
          while IFS= read -r app_file; do
            APP_DIR=$(dirname "$app_file")
            APP_NAME=$(grep -E "name: " "$app_file" | head -1 | awk '{print $2}')
            
            if [ -n "$APP_NAME" ]; then
              APP_INFO["$APP_DIR"]="$APP_NAME"
              echo "Found application: $APP_NAME in $APP_DIR"
            fi
          done < <(find argoproj -name "application.yaml")
          
          # 変更があったアプリケーションのdiffを取得
          FOUND_CHANGES=false
          for dir in $CHANGED_DIRS; do
            # ディレクトリツリーを上に遡って最も近いapplication.yamlを持つディレクトリを探す
            CURRENT_DIR=$dir
            while [[ "$CURRENT_DIR" == argoproj* ]]; do
              if [ -n "${APP_INFO[$CURRENT_DIR]}" ]; then
                APP_NAME="${APP_INFO[$CURRENT_DIR]}"
                echo "Changes detected for application: $APP_NAME (in $CURRENT_DIR)"
                FOUND_CHANGES=true
                
                # Diffの結果を追記
                echo "### アプリケーション: $APP_NAME の差分" >> app_diff_results.md
                echo "パス: $CURRENT_DIR" >> app_diff_results.md
                echo '```diff' >> app_diff_results.md
                
                # Diffを取得
                REPO_ROOT=$(pwd)
                if ! argocd app diff "argocd/$APP_NAME" \
                  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID,CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
                  --grpc-web \
                  --insecure \
                  --local-repo-root "$REPO_ROOT" \
                  --local "$REPO_ROOT/$CURRENT_DIR" >> app_diff_results.md 2>&1; then
                  echo "Error getting diff for $APP_NAME" >> app_diff_results.md
                fi
                
                echo '```' >> app_diff_results.md
                echo "" >> app_diff_results.md
                break  # 最も近いapplication.yamlが見つかったらループを抜ける
              fi
              
              # 親ディレクトリに移動
              CURRENT_DIR=$(dirname "$CURRENT_DIR")
            done
          done
          
          # 変更がない場合のメッセージ
          if [ "$FOUND_CHANGES" = false ]; then
            echo "### 変更されたアプリケーションはありません" > app_diff_results.md
          fi
          
          echo "has_changes=$FOUND_CHANGES" >> $GITHUB_OUTPUT
      
      - name: Comment PR
        uses: actions/github-script@v6
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const diffOutput = fs.readFileSync('app_diff_results.md', 'utf8');
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## ArgoCD Diff Result\n${diffOutput}`
            });
```

#### 3.3.2 アプリケーション検出アルゴリズム

このワークフローは、以下のアルゴリズムを使用して差分を検出します：

1. `argoproj`配下の全ての`application.yaml`ファイルを検索し、アプリケーション名とそのディレクトリパスを辞書として保持します。
2. PRで変更されたファイルのパスからディレクトリを特定します。
3. 各変更ディレクトリに対して、最も近い（ディレクトリツリーを上に遡って）`application.yaml`を持つディレクトリを探し、該当するArgo CDアプリケーションを特定します。
4. 特定したアプリケーションに対して`argocd app diff`コマンドを実行して差分を取得します。
5. 取得した差分をPRコメントとして表示します。

このアプローチにより、以下の利点があります：
- マッピングファイルのメンテナンスが不要になります
- リポジトリ構造の変更にも柔軟に対応できます
- `application.yaml`に記載されている実際のアプリケーション名を使用するため正確です

#### 3.3.3 Argo CD CLIのログイン最適化

このワークフローは、Argo CD CLIの認証処理を最適化しています：

1. Argo CD CLIのインストール直後に一度だけログインを実行し、セッションを確立します。
2. 複数のアプリケーションに対する差分チェックでは、既存のセッションを再利用します。

この最適化により、以下のメリットがあります：
- 複数回のログイン処理による無駄な時間とリソースの消費を防ぎます
- APIサーバーへの認証リクエストの数を減らし、サーバー負荷を軽減します
- ログインに失敗した場合に早期に検出できるため、トラブルシューティングが容易になります

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

### 4.2 Argo CD API設定

1. Argo CDの設定マニフェストを修正して、GitHub Actions用のAPIアクセスを設定します。まず、`argocd-cm`のoverlayを作成または編集します：
   ```bash
   vim lolice/argoproj/argocd/overlays/argocd-cm.yaml
   ```
   
   次の内容を追加して、API Key生成機能を持つ専用アカウントを作成します：
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: argocd-cm
     namespace: argocd
     labels:
       app.kubernetes.io/name: argocd-cm
       app.kubernetes.io/part-of: argocd
   data:
     # GitHub Actions用のAPIアクセス専用アカウント
     # apiKey - API Key生成機能を有効化
     accounts.github-actions: apiKey
   ```

2. 次に、`argocd-rbac-cm`のoverlayを作成または編集して、作成したアカウントにアプリケーション参照の権限を付与します：
   ```bash
   vim lolice/argoproj/argocd/overlays/argocd-rbac-cm.yaml
   ```
   
   以下の内容を追加して、読み取り専用の権限を設定します：
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: argocd-rbac-cm
     labels:
       app.kubernetes.io/name: argocd-rbac-cm
       app.kubernetes.io/part-of: argocd
   data:
     policy.csv: |
       # 既存のポリシーがある場合は、その下に追加します
       g, github-actions, role:readonly
   ```

3. overlayファイルを`kustomization.yaml`に追加します（既に含まれている場合は不要）：
   ```bash
   vim lolice/argoproj/argocd/kustomization.yaml
   ```
   
   以下のようにpatchesStrategicMergeセクションに追加されていることを確認します：
   ```yaml
   patchesStrategicMerge:
   - overlays/argocd-cm.yaml
   - overlays/argocd-rbac-cm.yaml
   # 他のoverlaysファイル...
   ```

4. 変更をリポジトリにプッシュし、Argo CDを通じて適用した後、アカウント用のAPIトークンを生成します：
   ```bash
   # Argo CDサーバーにログイン
   argocd login <argocd-server> --username admin --password <admin-password>
   
   # github-actionsアカウント用のトークンを生成
   argocd account generate-token --account github-actions
   ```

5. 生成されたトークンはGitHubリポジトリのSecretsに保存します（「4.4 GitHub Action設定」参照）。

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
4. ArgoCD kustomization.yamlを更新して新しいマニフェストを含める:
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
   patchesStrategicMerge:
   - overlays/argocd-redis-network-policy.yaml
   - overlays/argocd-repo-server-network-policy.yaml
   - overlays/argocd-server-network-policy.yaml
   - overlays/argocd-cmd-params-cm.yaml
   - overlays/argocd-cm.yaml
   - overlays/argocd-rbac-cm.yaml
   ```
5. 変更をリポジトリにプッシュし、ArgoCD経由でデプロイ

### 4.4 GitHub Action設定

1. GitHub Actionワークフロー定義を作成:
   ```bash
   mkdir -p lolice/.github/workflows/
   vim lolice/.github/workflows/argocd-diff.yaml
   ```
   設定内容は「3.3.1 差分確認ワークフロー」を参照してください。

2. GitHubリポジトリのSecretsに必要な値を設定:
   - `ARGOCD_SERVER_URL`: `https://argocd-api.b0xp.io`
   - `ARGOCD_AUTH_TOKEN`: 前のステップ（4.2）で生成したArgo CD APIトークン
   - `ARGOCD_API_TOKEN_ID`: AWS SSM Parameter Storeに保存されたCloudflare Accessサービストークンのclient_id
   - `ARGOCD_API_TOKEN_SECRET`: AWS SSM Parameter Storeに保存されたCloudflare Accessサービストークンのclient_secret

3. テスト用のPRを作成して、ワークフローが正しく動作することを確認します。エラーが発生する場合は、以下の点を確認してください：
   - アプリケーション名が正しく抽出されているか
   - Argo CDへの認証が成功しているか
   - Argo CD CLIのバージョンがサーバーと互換性があるか

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
   - `application.yaml`の形式と内容の確認
   - Argo CD CLIのバージョン互換性の確認
   - 必要に応じてdebugログを有効化して詳細な情報を取得

### 7.4 トラブルシューティング

#### 7.4.1 GitHub Action エラー対応

GitHub Actionの実行時に以下のようなエラーが発生する場合があります：

1. **アプリケーション名の抽出エラー**:
   ```
   Could not find application name in application.yaml
   ```

   **解決策**:
   - `application.yaml`ファイルの形式を確認する
   - `name:`フィールドが正しく設定されているか確認する

2. **Argo CD CLI接続エラー**:
   ```
   Error: failed to establish connection to api-server:
   ```

   **解決策**:
   - サーバーURLが正しいか確認する
   - Cloudflare Access認証情報が有効か確認する
   - Argo CD APIトークンが有効か確認する

3. **diff取得エラー**:
   ```
   Error: rpc error: code = NotFound desc = application not found
   ```

   **解決策**:
   - アプリケーション名が正しく抽出されているか確認する
   - 指定したアプリケーションがArgo CDサーバーに存在するか確認する
   - ローカルパスが正しく指定されているか確認する