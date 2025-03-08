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