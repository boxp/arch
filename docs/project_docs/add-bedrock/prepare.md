# AWS Bedrock (Claude 3.7 Sonnet)利用のための準備

## 概要

このドキュメントでは、lolice clusterでホスティングされているopenhandsでAWS Bedrockが提供するClaude 3.7 Sonnet AIを利用するための準備手順を説明します。AWSリソースの作成はTerraformを使用して行います。

## 前提条件

- AWS アカウントへのアクセス権限
- Terraformのインストール（バージョン1.0以上推奨）
- AWS CLIの設定（Terraformの実行用）
- lolice clusterの管理権限

## AWS Bedrockサービスの事前設定

Terraformでリソースを作成する前に、AWS Bedrockサービスに関する以下の事前設定が必要です：

### 1. AWS Bedrockサービスへのアクセス権限の確認

AWS Bedrockは一部のリージョンでのみ利用可能で、特に新しいモデル（Claude 3.7 Sonnet）へのアクセスには制限がある場合があります。

1. AWSコンソールにログインし、Bedrockサービスにアクセスできることを確認
2. 使用するリージョン（us-west-2）でBedrockサービスが利用可能であることを確認

### 2. Claude 3.7 Sonnetモデルへのアクセス許可申請

1. AWSコンソールで「AWS Bedrock」サービスに移動
2. 「Model access」または「モデルアクセス」セクションに進む
3. Claude 3.7 Sonnetモデル（anthropic.claude-3-7-sonnet-20250219-v1:0）にアクセス申請（Access request）を行う
4. 利用規約に同意し、アクセス申請を送信
5. 申請が承認されるまで待機（通常は数分〜24時間程度）

### 3. サービスクォータの確認と調整

1. AWSコンソールの「Service Quotas」に移動
2. AWS Bedrockサービスのクォータを確認
3. 特に以下のクォータに注目し、必要に応じて引き上げリクエストを行う：
   - InvokeModel API requests per second
   - InvokeModelWithResponseStream API requests per second
   - Tokens per minute for Claude 3.7 Sonnet

### 4. 料金体系の確認

- AWS Bedrockの料金は使用したトークン数に基づいて課金
- Claude 3.7 Sonnetの入力/出力トークンそれぞれの料金を確認し、予算計画を立てる

## 手順の流れ

1. Terraformを使用したAWS IAM Userの作成とBedrockに必要な権限の付与
2. Terraformを使用したSSM Parameterへの認証情報の保存
3. External Secrets Operatorの設定
4. openhandsへの環境変数の設定

## 1. Terraformを使用したAWS IAM Userの作成と権限付与

### 1.1 Terraformファイルの準備

`terraform/aws/openhands/`ディレクトリにはすでに以下のファイルが存在しています：

```
terraform/aws/openhands/
├── backend.tf        # すでに存在（S3バックエンドの設定）
├── provider.tf       # すでに存在（AWS Provider設定）
├── tfaction.yaml     # すでに存在
└── その他の設定ファイル
```

以下の新しいファイルを追加します：

```
terraform/aws/openhands/
├── variables.tf      # 変数定義
├── iam.tf            # IAMリソース定義
└── ssm.tf            # SSMパラメータ定義
```

### 1.2 variables.tfの作成

```hcl
# terraform/aws/openhands/variables.tf
variable "environment" {
  description = "Environment name (e.g. dev, prod)"
  type        = string
  default     = "prod"
}

variable "bedrock_model_id" {
  description = "AWS Bedrock model ID for Claude 3.7 Sonnet"
  type        = string
  default     = "anthropic.claude-3-7-sonnet-20250219-v1:0"
}

variable "bedrock_region" {
  description = "AWS region where Bedrock is available"
  type        = string
  default     = "us-west-2"
}
```

### 1.3 iam.tfの作成（IAMユーザーと権限の設定）

```hcl
# terraform/aws/openhands/iam.tf
resource "aws_iam_user" "bedrock_user" {
  name = "bedrock-openhands-user"
  path = "/service/"
}

resource "aws_iam_access_key" "bedrock_user_key" {
  user = aws_iam_user.bedrock_user.name
}

# カスタムポリシーの作成（最小権限の原則に基づく）
resource "aws_iam_policy" "bedrock_policy" {
  name        = "bedrock-openhands-policy"
  description = "Policy for accessing AWS Bedrock Claude 3.7 Sonnet"
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:GetModelCustomizationJob",
          "bedrock:ListModelCustomizationJobs",
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel"
        ]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/${var.bedrock_model_id}"
        ]
      }
    ]
  })
}

# ポリシーをIAMユーザーにアタッチ
resource "aws_iam_user_policy_attachment" "bedrock_policy_attachment" {
  user       = aws_iam_user.bedrock_user.name
  policy_arn = aws_iam_policy.bedrock_policy.arn
}
```

### 1.4 ssm.tfの作成（SSMパラメータの設定）

```hcl
# terraform/aws/openhands/ssm.tf
# アクセスキーIDをSSMパラメータに保存
resource "aws_ssm_parameter" "bedrock_access_key_id" {
  name        = "bedrock-access-key-id"
  description = "AWS Access Key ID for Bedrock service"
  type        = "SecureString"
  value       = aws_iam_access_key.bedrock_user_key.id
}

# シークレットアクセスキーをSSMパラメータに保存
resource "aws_ssm_parameter" "bedrock_secret_access_key" {
  name        = "bedrock-secret-access-key"
  description = "AWS Secret Access Key for Bedrock service"
  type        = "SecureString"
  value       = aws_iam_access_key.bedrock_user_key.secret
}
```

### 1.5 Terraformの実行

準備したTerraformファイルを実行して、AWSリソースを作成します。

```bash
cd terraform/aws/openhands
terraform init
terraform plan
terraform apply
```

承認を求められたら、`yes`と入力して実行を続行します。

## 2. External Secrets Operatorの設定

lolice clusterでExternal Secrets Operator (ESO)を使用して、AWS SSM Parameterに保存された認証情報をKubernetes Secretとして取得します。

### 2.1 SecretStoreの設定

1. AWS SSMへのアクセス権を持つSecretStoreリソースを作成（既存のものがあれば再利用可）:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secretstore
  namespace: openhands
spec:
  provider:
    aws:
      service: ParameterStore
      region: ap-northeast-1  # backend.tfで設定されているregionと同じにする
      auth:
        # クラスター上のサービスアカウントまたはIAM Roleの設定によって異なる
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
```

### 2.2 ExternalSecretの設定

AWS SSM Parameterから値を取得してKubernetes Secretを作成するExternalSecretを定義:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: bedrock-credentials
  namespace: openhands
spec:
  refreshInterval: "15m"  # 更新間隔
  secretStoreRef:
    name: aws-secretstore
    kind: SecretStore
  target:
    name: bedrock-credentials  # 作成されるKubernetes Secretの名前
  data:
  - secretKey: AWS_ACCESS_KEY_ID
    remoteRef:
      key: bedrock-access-key-id
  - secretKey: AWS_SECRET_ACCESS_KEY
    remoteRef:
      key: bedrock-secret-access-key
```

## 3. openhandsへの環境変数の設定

作成されたKubernetes Secretをopenhandsのコンテナに環境変数として渡します。

### 3.1 Deploymentの更新

openhandsのDeploymentまたはStatefulSetを更新して、SecretからAWS認証情報を環境変数として設定:

```yaml
# openhandsのDeployment/StatefulSetの一部
spec:
  template:
    spec:
      containers:
      - name: openhands
        # 他の設定...
        env:
        # 既存の環境変数...
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: bedrock-credentials
              key: AWS_ACCESS_KEY_ID
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: bedrock-credentials
              key: AWS_SECRET_ACCESS_KEY
        - name: AWS_REGION
          value: "us-west-2"  # Bedrockが利用可能なリージョン（variables.tfで設定したbedrock_region）
```

### 3.2 その他の必要な環境変数

AWS Bedrockを使用するために、追加の環境変数が必要な場合があります:

```yaml
env:
# 上記に加えて...
- name: AWS_DEFAULT_REGION
  value: "us-west-2"  # Bedrockが利用可能なリージョン
- name: BEDROCK_MODEL_ID
  value: "anthropic.claude-3-7-sonnet-20250219-v1:0"  # Claude 3.7 Sonnetのモデルid
```

## 注意事項

- Terraformの状態ファイル（`.tfstate`）は既にS3バックエンドに保存されるよう設定されています
- IAM権限は最小権限の原則に従い、必要最低限に設定してください
- 本番環境ではさらに堅牢な認証方法（IAM Roleの使用など）を検討してください
- AWS Bedrockの料金体系を確認し、コスト管理を行ってください
- アクセスキーのローテーションを行う場合は、Terraformで新しいキーを生成し、古いキーを無効化してください

## トラブルシューティング

認証情報が正しく設定されているにもかかわらず接続に問題がある場合:

1. AWS_REGIONがBedrockサービスが利用可能なリージョンに設定されていることを確認
2. IAMユーザーに適切な権限が付与されていることを確認
3. lolice cluster内のPod/Containerから適切なネットワーク経路でAWSサービスにアクセスできることを確認
4. Secretが正しく作成され、環境変数が正しく設定されていることを確認
5. Terraformで作成したリソースが意図した通りに作成されているか確認
