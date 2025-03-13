# OpenHandsランタイムイメージへのAWS認証情報実装設計書

## 1. 概要

### 1.1 目的

このドキュメントでは、OpenHandsのランタイムイメージにAWS認証情報を安全に提供するための実装設計について詳述します。この実装により、OpenHandsエージェントがAWSリソース（S3バケットなど）に安全にアクセスできるようになります。

### 1.2 背景

現在のOpenHandsランタイムイメージには、AWSリソースにアクセスするための認証情報が含まれていません。そのため、OpenHandsエージェントがAWSリソースを利用する際に制限があります。この問題を解決するために、AWS認証情報をランタイムイメージに安全に組み込む必要があります。

### 1.3 スコープ

- カスタムOpenHandsランタイムDockerイメージの作成
- AWS IAMリソース（ユーザー、ロール、ポリシー）の設定
- GitHub ActionsでのOIDC認証を使用したAWS認証情報の取得
- Kubernetesデプロイメント設定の更新

## 2. アーキテクチャ

### 2.1 全体アーキテクチャ

```
┌─────────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  GitHub Actions │────▶│ AWS SSM Parameter │────▶│ ECR Repository  │
└─────────────────┘     └───────────────────┘     └─────────────────┘
         │                                                 │
         │                                                 ▼
         │                                        ┌─────────────────┐
         └───────────────────────────────────────▶│ Kubernetes     │
                                                  │ Deployment     │
                                                  └─────────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │ OpenHands Pod   │
                                                  │ with AWS Creds  │
                                                  └─────────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │ AWS Resources   │
                                                  │ (S3, etc.)      │
                                                  └─────────────────┘
```

### 2.2 コンポーネント

1. **カスタムランタイムイメージ**
   - OpenHandsの公式ベースイメージをベースに構築
   - AWS CLIとSDKを含む
   - AWS認証情報を環境変数から取得するエントリポイントスクリプト

2. **AWS IAMリソース**
   - OpenHandsランタイム用のIAMユーザー
   - GitHub Actions用のIAMロール（OIDC認証）
   - 必要なIAMポリシー

3. **GitHub Actionsワークフロー**
   - OIDC認証を使用してAWSにアクセス
   - SSM Parameter Storeから認証情報を取得
   - カスタムランタイムイメージをビルドしてECRにプッシュ

4. **Kubernetesリソース**
   - OpenHandsデプロイメント
   - AWS認証情報を含むKubernetes Secret

## 3. 詳細設計

### 3.1 カスタムランタイムイメージ

#### 3.1.1 Dockerfile

```dockerfile
FROM nikolaik/python-nodejs:python3.12-nodejs22

# 必要なパッケージのインストール
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    git \
    && rm -rf /var/lib/apt/lists/*

# AWS CLIのインストール
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# OpenHandsに必要な追加パッケージのインストール
RUN pip install --no-cache-dir boto3 awscli

# コンテナ起動時にAWS認証情報を環境変数から取得するためのエントリポイントスクリプト
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# OpenHandsのデフォルトユーザーとして実行
USER 1000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "-m", "openhands.server"]
```

#### 3.1.2 エントリポイントスクリプト

```bash
#!/bin/bash
set -e

# AWS認証情報が環境変数として設定されていることを確認
if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "AWS credentials found in environment variables"
  
  # AWS認証情報ディレクトリの作成
  mkdir -p ~/.aws
  
  # AWS認証情報の設定
  cat > ~/.aws/credentials << AWSEOF
[default]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
AWSEOF

  # リージョンの設定（環境変数から取得または既定値を使用）
  cat > ~/.aws/config << AWSEOF
[default]
region = ${AWS_REGION:-ap-northeast-1}
AWSEOF

  echo "AWS credentials configured successfully"
fi

# 元のコマンドを実行
exec "$@"
```

### 3.2 AWS IAMリソース

#### 3.2.1 GitHub Actions用のOIDCプロバイダーとロール

```json
// OIDC信頼ポリシー
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:boxp/lolice:*"
        }
      }
    }
  ]
}
```

#### 3.2.2 GitHub Actions用のIAMポリシー

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:ssm:*:${AWS_ACCOUNT_ID}:parameter/lolice/openhands/aws/*"
      ]
    }
  ]
}
```

#### 3.2.3 OpenHandsランタイム用のIAMポリシー

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::lolice-bucket/*",
        "arn:aws:s3:::lolice-bucket"
      ]
    }
  ]
}
```

### 3.3 GitHub Actionsワークフロー

```yaml
name: Build OpenHands Runtime Image

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
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/lolice-github-actions-role
          aws-region: ap-northeast-1

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Get AWS credentials from SSM Parameter Store
        run: |
          AWS_ACCESS_KEY_ID=$(aws ssm get-parameter --name /lolice/openhands/aws/access_key_id --with-decryption --query Parameter.Value --output text)
          AWS_SECRET_ACCESS_KEY=$(aws ssm get-parameter --name /lolice/openhands/aws/secret_access_key --with-decryption --query Parameter.Value --output text)
          echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> $GITHUB_ENV
          echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> $GITHUB_ENV

      - name: Build, tag, and push image to Amazon ECR
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: lolice/openhands-runtime
          IMAGE_TAG: ${{ github.sha }}
        run: |
          cd docker/openhands-runtime
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
                       -t $ECR_REGISTRY/$ECR_REPOSITORY:latest .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
          echo "::set-output name=image::$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"
```

### 3.4 Kubernetesリソース

#### 3.4.1 OpenHandsデプロイメント

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lolice-openhands
  namespace: lolice
spec:
  replicas: 1
  selector:
    matchLabels:
      app: lolice-openhands
  template:
    metadata:
      labels:
        app: lolice-openhands
    spec:
      containers:
      - name: openhands
        image: ${ECR_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/lolice/openhands-runtime:latest
        ports:
        - containerPort: 8000
        env:
        - name: AWS_REGION
          value: "ap-northeast-1"
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: openhands-aws-credentials
              key: aws-access-key-id
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: openhands-aws-credentials
              key: aws-secret-access-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
```

#### 3.4.2 AWS認証情報のKubernetes Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: openhands-aws-credentials
  namespace: lolice
type: Opaque
data:
  aws-access-key-id: ${AWS_ACCESS_KEY_ID_BASE64}
  aws-secret-access-key: ${AWS_SECRET_ACCESS_KEY_BASE64}
```

## 4. 実装計画

### 4.1 ディレクトリ構造

```
lolice/
├── .github/
│   └── workflows/
│       └── build-openhands-runtime.yml
├── docker/
│   └── openhands-runtime/
│       ├── Dockerfile
│       └── entrypoint.sh
├── k8s/
│   ├── openhands-deployment.yaml
│   └── openhands-secrets.yaml
└── scripts/
    ├── aws/
    │   └── setup-iam-resources.sh
    └── deploy-openhands.sh
```

### 4.2 実装ステップ

1. カスタムランタイムDockerfileとエントリポイントスクリプトの作成
2. AWS IAMリソース作成スクリプトの実装
3. GitHub Actionsワークフローの設定
4. Kubernetesマニフェストの更新
5. デプロイスクリプトの実装

### 4.3 実装スケジュール

| タスク | 担当者 | 期間 | 依存関係 |
|-------|-------|------|---------|
| カスタムランタイムDockerfileの作成 | TBD | 1日 | なし |
| AWS IAMリソース作成スクリプトの実装 | TBD | 1日 | なし |
| GitHub Actionsワークフローの設定 | TBD | 1日 | Dockerfile |
| Kubernetesマニフェストの更新 | TBD | 0.5日 | なし |
| デプロイスクリプトの実装 | TBD | 0.5日 | Kubernetesマニフェスト |
| テストと検証 | TBD | 1日 | すべて |

## 5. セキュリティ考慮事項

### 5.1 認証情報の保護

- AWS認証情報はSSM Parameter Storeの暗号化されたパラメータとして保存
- GitHub ActionsからAWSへの認証にはOIDC認証を使用し、長期的な認証情報の保存を避ける
- Kubernetes Secretsを使用して認証情報をポッドに提供

### 5.2 最小権限の原則

- OpenHandsランタイム用のIAMユーザーには必要最小限の権限のみを付与
- GitHub Actions用のIAMロールにも必要な権限のみを付与

### 5.3 監査とモニタリング

- AWS CloudTrailを有効にして、APIコールを監査
- AWS Config Rulesを設定して、セキュリティベストプラクティスの遵守を確認

## 6. テスト計画

### 6.1 ユニットテスト

- エントリポイントスクリプトのテスト
- IAMリソース作成スクリプトのテスト

### 6.2 統合テスト

- GitHub Actionsワークフローのテスト
- ECRへのイメージプッシュのテスト

### 6.3 エンドツーエンドテスト

- Kubernetesクラスタへのデプロイテスト
- OpenHandsエージェントからのAWSリソースアクセステスト

## 7. 運用計画

### 7.1 デプロイメント

- 初回デプロイメントはマニュアルで実施
- 以降のデプロイメントはGitHub Actionsで自動化

### 7.2 モニタリング

- AWS CloudWatchでIAMユーザーのアクティビティを監視
- Kubernetesログでエラーを監視

### 7.3 バックアップと復旧

- IAMユーザー認証情報のバックアップ
- ECRイメージのバックアップ

## 8. ロールバック計画

問題が発生した場合は、以下の手順でロールバックします：

1. 以前のデプロイメント設定に戻す
2. 以前のイメージバージョンを指定してデプロイ
3. 必要に応じてAWS認証情報を無効化

## 9. 参考資料

- [AWS IAM ユーザーガイド](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)
- [GitHub Actions OIDC認証](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Amazon ECR ユーザーガイド](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html)