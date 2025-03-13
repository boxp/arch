# OpenHands Runtime AWS Credentials 設計ドキュメント

## 1. 概要

このドキュメントでは、OpenHandsのランタイムイメージにAWS認証情報を安全に提供するための詳細な設計と実装計画を提供します。OpenHandsランタイムコンテナがAWSリソース（特にS3バケット）にアクセスするために必要な認証情報を、セキュアな方法で提供する方法を説明します。

## 2. 背景と目的

OpenHandsランタイムコンテナは、ユーザーのワークスペースでコードを実行するための環境を提供します。一部のユースケースでは、このランタイム環境からAWSリソース（特にS3バケット）にアクセスする必要があります。このドキュメントでは、以下の目標を達成するための設計を提案します：

1. OpenHandsランタイムコンテナにAWS認証情報を安全に提供する
2. 認証情報の漏洩リスクを最小限に抑える
3. 最小権限の原則に従ったアクセス制御を実装する
4. GitHub ActionsのOIDC認証を活用して一時的な認証情報を取得する

## 3. アーキテクチャ概要

提案するアーキテクチャは以下のコンポーネントで構成されます：

1. **カスタムOpenHandsランタイムイメージ**: AWS CLIとAWS SDKを含むカスタムDockerイメージ
2. **GitHub Actions OIDC Provider**: GitHub ActionsからAWSへの認証に使用
3. **AWS IAMロール**: 最小権限を持つ専用のIAMロール
4. **AWS SSM Parameter Store**: 設定値の安全な保存
5. **エントリポイントスクリプト**: コンテナ起動時にAWS認証情報を設定

### 3.1 システム構成図

```
[GitHub Actions] ---(OIDC認証)---> [AWS STS] ---(一時的な認証情報)---> [AWS IAMロール]
                                                                          |
[OpenHands] ---(コンテナ起動)---> [カスタムランタイムイメージ] ---(認証情報取得)---> [AWS SSM]
                                   |                                       |
                                   |---(AWS CLIコマンド実行)------------> [AWS S3]
```

## 4. 詳細設計

### 4.1 カスタムOpenHandsランタイムイメージ

既存のOpenHandsランタイムイメージを拡張し、AWS CLIとAWS SDKをインストールします。

```dockerfile
FROM docker.all-hands.dev/all-hands-ai/runtime:0.27-nikolaik

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

# エントリポイントスクリプトの追加
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

### 4.2 エントリポイントスクリプト

コンテナ起動時にAWS認証情報を設定するエントリポイントスクリプト：

```bash
#!/bin/bash
set -e

# AWS認証情報の設定（環境変数から）
if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
  mkdir -p ~/.aws
  cat > ~/.aws/credentials << EOF
[default]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
EOF

  if [ -n "$AWS_SESSION_TOKEN" ]; then
    echo "aws_session_token = $AWS_SESSION_TOKEN" >> ~/.aws/credentials
  fi

  if [ -n "$AWS_REGION" ]; then
    cat > ~/.aws/config << EOF
[default]
region = $AWS_REGION
EOF
  fi

  echo "AWS credentials configured successfully"
fi

# 元のエントリポイントコマンドを実行
exec "$@"
```

### 4.3 GitHub Actions OIDC Provider設定

AWSにGitHub Actions OIDC Providerを設定します：

```hcl
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
```

### 4.4 IAMロールとポリシー

GitHub ActionsがAWS認証情報を取得するためのIAMロールとポリシー：

```hcl
resource "aws_iam_role" "openhands_runtime" {
  name = "openhands-runtime-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github_actions.arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:boxp/arch:*"
          }
        }
      }
    ]
  })
}

resource "aws_iam_policy" "openhands_s3_access" {
  name        = "openhands-s3-access"
  description = "Policy for OpenHands runtime to access S3"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Effect   = "Allow"
        Resource = [
          "arn:aws:s3:::openhands-data/*",
          "arn:aws:s3:::openhands-data"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "openhands_s3_access" {
  role       = aws_iam_role.openhands_runtime.name
  policy_arn = aws_iam_policy.openhands_s3_access.arn
}
```

### 4.5 GitHub Actions Workflow

GitHub Actionsでカスタムイメージをビルドし、AWS認証情報を設定するワークフロー：

```yaml
name: Build OpenHands Runtime with AWS

on:
  push:
    branches: [ main ]
    paths:
      - 'docker/openhands-runtime/**'
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
          role-to-assume: arn:aws:iam::123456789012:role/openhands-runtime-role
          aws-region: ap-northeast-1

      - name: Login to Docker Registry
        uses: docker/login-action@v2
        with:
          registry: docker.all-hands.dev
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: ./docker/openhands-runtime
          push: true
          tags: docker.all-hands.dev/all-hands-ai/runtime:0.27-aws
```

### 4.6 Kubernetes Deployment更新

OpenHandsデプロイメントを更新して、カスタムランタイムイメージを使用するように設定します：

```yaml
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
          value: docker.all-hands.dev/all-hands-ai/runtime:0.27-aws
        # ... 他の環境変数 ...
```

## 5. セキュリティ考慮事項

### 5.1 認証情報の保護

1. **一時的な認証情報**: GitHub Actions OIDCを使用して短期間の一時的な認証情報を取得
2. **最小権限**: 必要最小限のアクセス権限のみを付与
3. **認証情報の分離**: ランタイムコンテナ内でのみ認証情報を使用し、ホストシステムには露出させない

### 5.2 セキュリティリスク軽減策

1. **コンテナ分離**: OpenHandsランタイムコンテナは分離された環境で実行
2. **監査ログ**: AWS CloudTrailを有効にしてすべてのAPI呼び出しを記録
3. **定期的な認証情報のローテーション**: 定期的に認証情報を更新

## 6. テスト計画

### 6.1 ユニットテスト

1. エントリポイントスクリプトのテスト
2. AWS認証情報の設定テスト

### 6.2 統合テスト

1. GitHub ActionsからのAWS認証情報取得テスト
2. カスタムイメージのビルドテスト
3. S3バケットへのアクセステスト

### 6.3 セキュリティテスト

1. 認証情報の漏洩テスト
2. 権限の検証テスト

## 7. 運用計画

### 7.1 デプロイメント手順

1. Terraformコードを適用してAWS IAMリソースを作成
2. カスタムDockerイメージをビルドしてレジストリにプッシュ
3. Kubernetesデプロイメントを更新

### 7.2 モニタリングと監査

1. AWS CloudTrailでのAPI呼び出し監視
2. S3バケットアクセスログの有効化
3. 定期的なセキュリティレビュー

### 7.3 障害対応計画

1. 認証情報の漏洩時の対応手順
2. アクセス権限の問題発生時の対応手順

## 8. 代替案と検討事項

### 8.1 AWS IAM Roles for Service Accounts (IRSA)

Kubernetes Service Accountを使用してAWS IAMロールを関連付ける方法も検討しましたが、現在のKubernetesクラスター設定ではサポートされていないため採用しませんでした。

### 8.2 AWS環境変数の直接設定

環境変数としてAWS認証情報を直接設定する方法も検討しましたが、セキュリティリスクが高いため採用しませんでした。

## 9. 結論

この設計ドキュメントでは、OpenHandsランタイムイメージにAWS認証情報を安全に提供するための方法を提案しました。GitHub Actions OIDCを使用した一時的な認証情報の取得と、最小権限の原則に基づいたアクセス制御により、セキュリティリスクを最小限に抑えつつ、必要なAWSリソースへのアクセスを実現します。

## 付録: 参考リソース

- [GitHub Actions OIDC Provider](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS IAM Roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [AWS S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)