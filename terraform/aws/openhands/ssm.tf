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

# Google API用のAPIキーをSSMパラメータに保存
resource "aws_ssm_parameter" "google_api_key" {
  name        = "openhands-google-api-key"
  description = "Google API Key for OpenHands"
  type        = "SecureString"
  value       = var.google_api_key
}