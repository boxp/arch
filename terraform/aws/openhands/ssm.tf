# SSMリーダーユーザーのアクセスキーIDをSSMパラメータに保存
resource "aws_ssm_parameter" "ssm_reader_access_key_id" {
  name        = "ssm-reader-access-key-id"
  description = "AWS Access Key ID for SSM Parameter Reader"
  type        = "SecureString"
  value       = aws_iam_access_key.ssm_reader_user_key.id
}

# SSMリーダーユーザーのシークレットアクセスキーをSSMパラメータに保存
resource "aws_ssm_parameter" "ssm_reader_secret_access_key" {
  name        = "ssm-reader-secret-access-key"
  description = "AWS Secret Access Key for SSM Parameter Reader"
  type        = "SecureString"
  value       = aws_iam_access_key.ssm_reader_user_key.secret
}