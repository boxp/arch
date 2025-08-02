# SSM Parameters for Longhorn backup credentials
resource "aws_ssm_parameter" "longhorn_backup_access_key" {
  name        = "/longhorn/backup/aws-access-key-id"
  description = "AWS Access Key ID for Longhorn backup"
  type        = "SecureString"
  value       = aws_iam_access_key.longhorn_backup.id

  tags = {
    Description = "Longhorn backup user access key ID"
    Project     = "lolice"
  }
}

resource "aws_ssm_parameter" "longhorn_backup_secret_key" {
  name        = "/longhorn/backup/aws-secret-access-key"
  description = "AWS Secret Access Key for Longhorn backup"
  type        = "SecureString"
  value       = aws_iam_access_key.longhorn_backup.secret

  tags = {
    Description = "Longhorn backup user secret access key"
    Project     = "lolice"
  }
}

resource "aws_ssm_parameter" "longhorn_backup_endpoints" {
  name        = "/longhorn/backup/aws-endpoints"
  description = "AWS endpoints for Longhorn backup (optional)"
  type        = "String"
  value       = "" # デフォルトのAWSエンドポイントを使用

  tags = {
    Description = "Longhorn backup AWS endpoints (optional)"
    Project     = "lolice"
  }
}