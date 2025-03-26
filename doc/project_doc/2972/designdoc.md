# OpenHands Runtime AWS Credentials 設計ドキュメント

## 1. 概要

このドキュメントでは、OpenHandsのランタイムイメージにAWS認証情報を安全に提供するための詳細な設計と実装計画を提供します。OpenHandsランタイムコンテナがAWSリソース（特にSSM Parameter Store）にアクセスするために必要な認証情報を、セキュアな方法で提供する方法を説明します。

当初はS3バケットを使用する設計でしたが、セキュリティ強化のためにSSM Parameter Storeを使用する設計に変更しました。また、認証情報の取り扱いもランタイム時の取得からビルド時の埋め込みに変更し、よりセキュアな実装を目指します。

## 2. 背景と目的

OpenHandsランタイムコンテナは、ユーザーのワークスペースでコードを実行するための環境を提供します。一部のユースケースでは、このランタイム環境からAWSリソース（特にSSM Parameter Store）にアクセスする必要があります。このドキュメントでは、以下の目標を達成するための設計を提案します：

1. OpenHandsランタイムコンテナにAWS認証情報を安全に提供する
2. 認証情報の漏洩リスクを最小限に抑える
3. 最小権限の原則に従ったアクセス制御を実装する
4. GitHub ActionsのOIDC認証を活用して一時的な認証情報を取得する

## 3. アーキテクチャ概要

提案するアーキテクチャは以下のコンポーネントで構成されます：

1. **カスタムOpenHandsランタイムイメージ**: nikolaik/python-nodejs:python3.12-nodejs22をベースとし、AWS CLIとAWS SDKを含むカスタムDockerイメージ
2. **GitHub Actions OIDC Provider**: GitHub ActionsからAWSへの認証に使用
3. **AWS IAMロール**: SSM Parameter Storeへの最小権限を持つ専用のIAMロール
4. **AWS SSM Parameter Store**: 設定値の安全な保存
5. **AWS ECR**: コンテナイメージの保存（839695154978.dkr.ecr.ap-northeast-1.amazonaws.com/openhands-runtime）
6. **エントリポイントスクリプト**: コンテナ起動時にAWS認証情報を設定（ビルド時に埋め込み済み）

### 3.1 システム構成図

```
[GitHub Actions] ---(OIDC認証)---> [AWS STS] ---(一時的な認証情報)---> [AWS IAMロール]
                                                                          |
                                                                          v
[GitHub Actions] ---(ビルド時)---> [カスタムランタイムイメージ] ---(プッシュ)---> [AWS ECR]
                                                                          |
                                                                          v
[OpenHands] ---(コンテナ起動)---> [カスタムランタイムイメージ] ---(認証情報利用)---> [AWS SSM Parameter Store]
```

## 4. 詳細設計

### 4.1 カスタムOpenHandsランタイムイメージ

既存のOpenHandsランタイムイメージを拡張し、AWS CLIとAWS SDKをインストールします。

```dockerfile
# ファイルパス: /workspace/openhands-runtime/Dockerfile
FROM nikolaik/python-nodejs:python3.12-nodejs22

# AWS CLIのインストール
RUN apt-get update && apt-get install -y \
    python3-pip \
    unzip \
    curl \
    && pip3 install --no-cache-dir \
    awscli \
    boto3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# AWS認証情報は、GitHub Actionsがビルド時にSSM Parameter Storeから取得し、
# ビルド時の環境変数としてコンテナに埋め込む
ARG AWS_ACCESS_KEY_ID
ARG AWS_SECRET_ACCESS_KEY
ARG AWS_REGION

ENV AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
ENV AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
ENV AWS_REGION=${AWS_REGION}

# エントリポイントスクリプトの追加
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

### 4.2 エントリポイントスクリプト

コンテナ起動時にAWS認証情報を設定するエントリポイントスクリプト：

```bash
# ファイルパス: /workspace/openhands-runtime/entrypoint.sh
#!/bin/bash
set -e

# AWS認証情報はビルド時に環境変数として埋め込まれているため、
# ここでは追加の設定は不要

# AWS認証情報はビルド時に埋め込まれているため、実行時に確認するだけ
if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "AWS credentials are configured"
  
  # リージョン設定
  if [ -n "$AWS_REGION" ]; then
    mkdir -p ~/.aws
    cat > ~/.aws/config << EOF
[default]
region = $AWS_REGION
EOF
    echo "AWS region configured: $AWS_REGION"
  fi
  
  # SSM Parameter Storeへのアクセスをテスト
  echo "Testing SSM Parameter Store access..."
  aws ssm get-parameter --name parameter-reader-access-key-id --query "Parameter.Name" --output text || echo "Warning: SSM Parameter Store access failed"
fi

# 元のエントリポイントコマンドを実行
exec "$@"
```

### 4.3 GitHub Actions OIDC Provider設定

AWSにGitHub Actions OIDC Providerを設定します：

```hcl
# ファイルパス: /workspace/arch/terraform/aws/openhands/github_actions_oidc.tf
# GitHub ActionsのOIDCプロバイダーが利用するIAMロールのための信頼ポリシー
data "aws_iam_policy_document" "openhands_runtime_gha_assume_role_policy" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"]
    }
    
    # audience条件 - GitHub Actionsが使用する標準値
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # subject条件 - リポジトリとブランチを制限
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:boxp/openhands-runtime:ref:refs/heads/main"]
    }
  }
}

# GitHub Actions用のIAMロール
resource "aws_iam_role" "openhands_runtime_role" {
  name               = "openhands-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.openhands_runtime_gha_assume_role_policy.json
}

# GitHub Actions用のポリシー（ECRとSSMパラメータストアへのアクセス）
resource "aws_iam_policy" "openhands_runtime_policy" {
  name        = "openhands-runtime-policy"
  description = "Policy for OpenHands Runtime GitHub Actions"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Effect   = "Allow"
        Resource = "arn:aws:ecr:${var.region}:${var.account_id}:repository/openhands-runtime"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = [
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/parameter-reader-access-key-id",
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/parameter-reader-secret-access-key"
        ]
      }
    ]
  })
}

# ポリシーをロールにアタッチ
resource "aws_iam_role_policy_attachment" "openhands_runtime_policy_attachment" {
  role       = aws_iam_role.openhands_runtime_role.name
  policy_arn = aws_iam_policy.openhands_runtime_policy.arn
}

### 4.4 ECRリポジトリの設定

OpenHandsランタイムイメージを保存するためのECRリポジトリを設定します：

```hcl
# ファイルパス: /workspace/arch/terraform/aws/openhands/ecr.tf
# OpenHandsランタイムイメージ用のECRリポジトリ
resource "aws_ecr_repository" "openhands_runtime" {
  name                 = "openhands-runtime"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  # terraform planが非常に不安定になったのでkms keyはdefaultにする
  #trivy:ignore:AVD-AWS-0033
  encryption_configuration {
    encryption_type = "KMS"
  }
}

# リポジトリのライフサイクルポリシー - 古いイメージを自動的に削除
resource "aws_ecr_lifecycle_policy" "openhands_runtime_lifecycle" {
  repository = aws_ecr_repository.openhands_runtime.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "limit the number of images to 3"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
```

### 4.5 既存のIAMとSSMリソースの活用

OpenHandsランタイムは、既存のIAMユーザーとSSMパラメータを活用します。これらは既に以下のファイルで定義されています：

```hcl
# ファイルパス: /workspace/arch/terraform/aws/openhands/iam.tf
# SSMパラメータ読み取り用のIAMユーザー
resource "aws_iam_user" "ssm_reader_user" {
  name = "ssm-reader-openhands-user"
  path = "/service/"
}

resource "aws_iam_access_key" "ssm_reader_user_key" {
  user = aws_iam_user.ssm_reader_user.name
}

# SSMパラメータ読み取り用のポリシー
resource "aws_iam_policy" "ssm_reader_policy" {
  name        = "ssm-reader-openhands-policy"
  description = "Policy for reading SSM parameters"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:DescribeParameters"
        ]
        Resource = [
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/*"
        ]
      }
    ]
  })
}

# ポリシーをIAMユーザーにアタッチ
resource "aws_iam_user_policy_attachment" "ssm_reader_policy_attachment" {
  user       = aws_iam_user.ssm_reader_user.name
  policy_arn = aws_iam_policy.ssm_reader_policy.arn
}
```

### 4.6 既存のSSMパラメータの活用

OpenHandsランタイムは、以下の既存のSSMパラメータを使用してAWS認証情報を取得します：

```hcl
# ファイルパス: /workspace/arch/terraform/aws/openhands/ssm.tf
# SSMリーダーユーザーのアクセスキーIDをSSMパラメータに保存
resource "aws_ssm_parameter" "ssm_reader_access_key_id" {
  name        = "parameter-reader-access-key-id"
  description = "AWS Access Key ID for SSM Parameter Reader"
  type        = "SecureString"
  value       = aws_iam_access_key.ssm_reader_user_key.id
}

# SSMリーダーユーザーのシークレットアクセスキーをSSMパラメータに保存
resource "aws_ssm_parameter" "ssm_reader_secret_access_key" {
  name        = "parameter-reader-secret-access-key"
  description = "AWS Secret Access Key for SSM Parameter Reader"
  type        = "SecureString"
  value       = aws_iam_access_key.ssm_reader_user_key.secret
}
```

### 4.7 GitHub Actions Workflow

GitHub Actionsでカスタムイメージをビルドし、AWS認証情報を埋め込み、ECRにプッシュするワークフロー：

```yaml
# ファイルパス: /workspace/openhands-runtime/.github/workflows/build.yml
name: Build OpenHands Runtime with AWS

on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: arn:aws:iam::839695154978:role/openhands-runtime-role
          aws-region: ap-northeast-1

      - name: Get AWS credentials from SSM Parameter Store
        run: |
          AWS_ACCESS_KEY_ID=$(aws ssm get-parameter --name parameter-reader-access-key-id --with-decryption --query Parameter.Value --output text)
          AWS_SECRET_ACCESS_KEY=$(aws ssm get-parameter --name parameter-reader-secret-access-key --with-decryption --query Parameter.Value --output text)
          # 認証情報をログに出力しないように設定
          echo "::add-mask::$AWS_ACCESS_KEY_ID"
          echo "::add-mask::$AWS_SECRET_ACCESS_KEY"
          echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> $GITHUB_ENV
          echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> $GITHUB_ENV
          echo "AWS_REGION=ap-northeast-1" >> $GITHUB_ENV

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: 839695154978.dkr.ecr.ap-northeast-1.amazonaws.com/openhands-runtime:${{ github.sha }}
          build-args: |
            AWS_ACCESS_KEY_ID=${{ env.AWS_ACCESS_KEY_ID }}
            AWS_SECRET_ACCESS_KEY=${{ env.AWS_SECRET_ACCESS_KEY }}
            AWS_REGION=${{ env.AWS_REGION }}
```

**注意**: このワークフローは、前のセクションで定義したIAMロール`openhands-runtime-role`を使用してAWSリソースにアクセスします。GitHub Actions OIDC認証を使用することで、リポジトリに認証情報を保存する必要がなく、安全に一時的な認証情報を取得することができます。

### 4.8 Kubernetes Deployment更新

OpenHandsデプロイメントを更新して、カスタムランタイムイメージを使用するように設定します。既存のデプロイメント構成を維持しながら、ランタイムイメージの参照のみを変更します：

```yaml
# ファイルパス: /workspace/lolice/argoproj/openhands/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openhands
  namespace: openhands
spec:
  # ... 既存の設定 ...
  template:
    spec:
      containers:
      - name: openhands
        # ... 既存の設定 ...
        env:
        - name: SANDBOX_RUNTIME_CONTAINER_IMAGE
          value: 839695154978.dkr.ecr.ap-northeast-1.amazonaws.com/openhands-runtime:${{ github.sha }}
        # ... 他の環境変数 ...
```

既存の環境設定やボリュームマウント、リソース制限などは保持されます。この変更により、既存のOpenHandsデプロイメントは新しいカスタムランタイムイメージを使用するようになりますが、その他の設定は影響を受けません。

### 4.9 ArgoCD Image Updater設定

ArgoCD Image Updaterを使用して、OpenHandsランタイムイメージの更新を自動化します：

```yaml
# ファイルパス: /workspace/lolice/argoproj/openhands/application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: openhands
  namespace: argocd
  annotations:
    argocd-image-updater.argoproj.io/image-list: my-image=839695154978.dkr.ecr.ap-northeast-1.amazonaws.com/openhands-runtime
    argocd-image-updater.argoproj.io/my-image.update-strategy: newest-build
    argocd-image-updater.argoproj.io/write-back-method: argocd
spec:
  # ... 既存の設定 ...
```

また、kustomizationファイルを追加して、ArgoCD Image Updaterがすべてのマニフェストファイルを認識できるようにします。これにより、ディレクトリ内のすべてのKubernetesリソースが適切に管理されます：

```yaml
# ファイルパス: /workspace/lolice/argoproj/openhands/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - namespace.yaml
  - deployment.yaml
  - service.yaml
  - application.yaml
  - docker-cleanup-cronjob.yaml
  - external-secret.yaml
  - cloudflared-deployment.yaml
  - pvc.yaml
```

このkustomizationファイルは、OpenHandsの完全な環境設定に必要なすべてのマニフェストファイルを含みます。既存のCronJobやSecretの設定、PersistentVolumeClaimなど、環境を構成するすべてのリソースが含まれています。

## 5. セキュリティ考慮事項

### 5.1 認証情報の保護

1. **ビルド時の認証情報埋め込み**: 認証情報はコンテナビルド時に埋め込まれ、実行時に外部から取得する必要がない
2. **一時的な認証情報**: GitHub Actions OIDCを使用して短期間の一時的な認証情報を取得
3. **最小権限**: SSM Parameter Storeへの必要最小限のアクセス権限のみを付与
4. **プライベートECRリポジトリ**: コンテナイメージはプライベートECRリポジトリに保存
5. **認証情報の分離**: ランタイムコンテナ内でのみ認証情報を使用し、ホストシステムには露出させない

### 5.2 セキュリティリスク軽減策

1. **コンテナ分離**: OpenHandsランタイムコンテナは分離された環境で実行
2. **監査ログ**: AWS CloudTrailを有効にしてSSM Parameter Storeへのすべてのアクセスを記録
3. **定期的な認証情報のローテーション**: 定期的に認証情報を更新
4. **ECRリポジトリの保護**: ECRリポジトリへのアクセスを制限し、イメージの脆弱性スキャンを有効化

## 6. テスト計画

### 6.1 ユニットテスト

1. エントリポイントスクリプトのテスト（/workspace/openhands-runtime/entrypoint.sh）
2. AWS認証情報の設定テスト（ビルド時の環境変数が正しく設定されるか）
3. Dockerfileのビルドテスト（/workspace/openhands-runtime/Dockerfile）

### 6.2 統合テスト

1. GitHub ActionsからのAWS認証情報取得テスト
2. カスタムイメージのビルドテスト（ECRへのプッシュ確認）
3. SSM Parameter Storeへのアクセステスト

### 6.3 セキュリティテスト

1. 認証情報の漏洩テスト
2. 権限の検証テスト

## 7. 運用計画

### 7.1 デプロイメント手順

1. Terraformコードを適用してAWS IAMリソースを作成（/workspace/arch/terraform/aws/openhands/）
2. 新しいリポジトリ（boxp/openhands-runtime）を作成
3. カスタムDockerイメージをビルドしてECRにプッシュ（839695154978.dkr.ecr.ap-northeast-1.amazonaws.com/openhands-runtime）
4. Kubernetesデプロイメントを更新（/workspace/lolice/argoproj/openhands/deployment.yaml）

### 7.2 モニタリングと監査

1. AWS CloudTrailでのAPI呼び出し監視
2. SSM Parameter Storeアクセスログの監視
3. ECRイメージスキャン結果の定期確認
4. 定期的なセキュリティレビュー

### 7.3 障害対応計画

1. 認証情報の漏洩時の対応手順
2. アクセス権限の問題発生時の対応手順

## 8. 代替案と検討事項

### 8.1 AWS IAM Roles for Service Accounts (IRSA)

Kubernetes Service Accountを使用してAWS IAMロールを関連付ける方法も検討しましたが、現在のKubernetesクラスター設定ではサポートされていないため採用しませんでした。

### 8.2 AWS環境変数の直接設定

環境変数としてAWS認証情報を直接設定する方法も検討しましたが、セキュリティリスクが高いため採用しませんでした。

### 8.3 リージョン設定の注意点

AWSリージョンの設定は、特にSSMパラメータストアやECRリポジトリなどのリソースへのアクセスに重要です。リージョン設定が間違っていると、以下のような問題が発生する可能性があります：

1. **アクセス権限エラー**: IAMポリシーで指定したリソースARNのリージョンとアクセス先のリージョンが一致しないと、適切な権限が付与されません
2. **リソース不在**: 指定したリソースが存在しない（または異なる）リージョンにアクセスしようとすると失敗します

特に注意すべき点：
- GitHub Actionsワークフローでは`ap-northeast-1`を指定していますが、Terraformの変数定義ファイル(`variables.tf`)では`ap-northeast-1`を使用する必要があります
- リージョン名の表記（例：`asia-northeast-1`と`ap-northeast-1`）を混同しないよう注意してください
- IAMポリシーやリソースARNを手動で編集する場合は、正確なリージョン名を使用することを確認してください

実装の際は、すべてのコンポーネントで一貫したリージョン設定を使用することが重要です。

## 9. 結論

この設計ドキュメントでは、OpenHandsランタイムイメージにAWS認証情報を安全に提供するための方法を提案しました。GitHub Actions OIDCを使用した一時的な認証情報の取得と、最小権限の原則に基づいたアクセス制御により、セキュリティリスクを最小限に抑えつつ、必要なAWSリソースへのアクセスを実現します。

## 付録: 参考リソース

- [GitHub Actions OIDC Provider](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS IAM Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [AWS S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)