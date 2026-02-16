# AWS Bedrock (Claude 3.7 Sonnet) 利用のための設計ドキュメント

## 1. 目的

lolice clusterで稼働しているopenhandsアプリケーションから、AWS Bedrockが提供するClaude 3.7 Sonnet AIモデルを利用できるようにするための設計と変更内容をまとめる。

## 2. 概要

このプロジェクトでは、以下の流れでAWS Bedrockへのアクセスを実現する：

1. archで専用のIAMユーザーとポリシーをTerraformで作成
2. 作成したIAMユーザーのアクセスキーをSSMパラメータストアに安全に保存
3. lolice clusterのExternal Secrets Operatorを使ってSSMパラメータの値をKubernetesのSecretとして取得
4. openhandsのPodに環境変数としてAWS認証情報を渡す

## 3. 変更が必要なコードベース

### 3.1 arch リポジトリの変更

#### 3.1.1 追加するTerraformファイル

**terraform/aws/openhands/variables.tf**
```hcl
# terraform/aws/openhands/variables.tf

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

**terraform/aws/openhands/iam.tf**
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

**terraform/aws/openhands/ssm.tf**
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

### 3.2 lolice リポジトリの変更

#### 3.2.1 ExternalSecret設定

**manifests/openhands/external-secrets.yaml**
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: bedrock-credentials
  namespace: openhands
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: parameterstore
    kind: ClusterSecretStore
  target:
    name: bedrock-credentials
    creationPolicy: Owner
  data:
  - secretKey: AWS_ACCESS_KEY_ID
    remoteRef:
      conversionStrategy: Default
      decodingStrategy: None
      key: bedrock-access-key-id
      metadataPolicy: None
  - secretKey: AWS_SECRET_ACCESS_KEY
    remoteRef:
      conversionStrategy: Default
      decodingStrategy: None
      key: bedrock-secret-access-key
      metadataPolicy: None
```

#### 3.2.3 openhands Deploymentの更新

**manifests/openhands/deployment.yaml**（既存のファイル名・パスは異なる可能性あり）

以下の環境変数設定を既存のDeploymentに追加：

```yaml
# openhandsのDeployment/StatefulSetの環境変数部分に追加
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
  value: "us-west-2"
- name: AWS_DEFAULT_REGION
  value: "us-west-2"
- name: BEDROCK_MODEL_ID
  value: "anthropic.claude-3-7-sonnet-20250219-v1:0"
```

## 4. デプロイ手順

### 4.1 arch側の変更適用

1. 上記のTerraformファイルを`terraform/aws/openhands/`ディレクトリに追加
2. Terraformを実行して変更を適用

```bash
cd terraform/aws/openhands
terraform init
terraform plan  # 変更内容を確認
terraform apply # 変更を適用
```

### 4.2 lolice側の変更適用

1. 上記のKubernetesマニフェストファイルを適切なディレクトリに追加
2. マニフェストファイルを適用

```bash
# 必要に応じてkubeconfigを設定
kubectl apply -f manifests/external-secrets/secretstore.yaml
kubectl apply -f manifests/openhands/external-secrets.yaml
kubectl apply -f manifests/openhands/deployment.yaml  # または既存のDeploymentを更新
```

## 5. 検証方法

以下の手順で設定が正しく機能しているか検証する：

1. Terraformの適用が成功し、IAMユーザーが作成されていることを確認
   ```bash
   aws iam get-user --user-name bedrock-openhands-user
   ```

2. SSMパラメータが正しく作成されていることを確認
   ```bash
   aws ssm get-parameter --name bedrock-access-key-id --with-decryption
   aws ssm get-parameter --name bedrock-secret-access-key --with-decryption
   ```

3. External Secretが正しく機能していることを確認
   ```bash
   kubectl get externalsecret bedrock-credentials -n openhands
   kubectl get secret bedrock-credentials -n openhands
   ```

4. openhandsのPodに環境変数が正しく設定されていることを確認
   ```bash
   kubectl exec -it <openhands-pod-name> -n openhands -- env | grep AWS
   kubectl exec -it <openhands-pod-name> -n openhands -- env | grep BEDROCK
   ```

5. openhandsアプリケーションからBedrockへのアクセスを実際に試して機能することを確認

## 6. ロールバック計画

設定に問題がある場合のロールバック手順：

1. openhandsのDeploymentから環境変数設定を削除
   ```bash
   kubectl edit deployment <openhands-deployment-name> -n openhands
   # 環境変数設定を削除
   ```

2. ExternalSecretとSecretを削除
   ```bash
   kubectl delete externalsecret bedrock-credentials -n openhands
   kubectl delete secret bedrock-credentials -n openhands
   ```

3. archリポジトリでTerraformの変更を元に戻す
   ```bash
   # Terraformファイルを削除または変更前に戻し、適用
   cd terraform/aws/openhands
   terraform destroy -target=aws_iam_user_policy_attachment.bedrock_policy_attachment
   terraform destroy -target=aws_iam_policy.bedrock_policy
   terraform destroy -target=aws_ssm_parameter.bedrock_secret_access_key
   terraform destroy -target=aws_ssm_parameter.bedrock_access_key_id
   terraform destroy -target=aws_iam_access_key.bedrock_user_key
   terraform destroy -target=aws_iam_user.bedrock_user
   ```

## 7. セキュリティ上の考慮事項

1. IAM権限は必要最小限に設定
2. アクセスキーはSecureStringタイプのSSMパラメータで保存
3. アクセスキーの定期的なロー
1. アクセスキーのローテーションを自動化
2. IAM Roleベースの認証に移行
3. AWS Bedrockの使用量とコストの監視メカニズムの導入
4. 複数のモデルバージョンへの対応
