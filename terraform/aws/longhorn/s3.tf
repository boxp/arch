# S3 bucket for Longhorn backups
resource "aws_s3_bucket" "longhorn_backup" {
  bucket = "boxp-longhorn-backup"
}

# Block all public access to the bucket
resource "aws_s3_bucket_public_access_block" "longhorn_backup" {
  bucket = aws_s3_bucket.longhorn_backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "longhorn_backup" {
  bucket = aws_s3_bucket.longhorn_backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "longhorn_backup" {
  bucket = aws_s3_bucket.longhorn_backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 bucket for access logs
#trivy:ignore:s3-bucket-logging
resource "aws_s3_bucket" "longhorn_backup_logs" {
  # Logging for the log bucket itself would be circular
  bucket = "boxp-longhorn-backup-logs"
}

resource "aws_s3_bucket_public_access_block" "longhorn_backup_logs" {
  bucket = aws_s3_bucket.longhorn_backup_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "longhorn_backup_logs" {
  bucket = aws_s3_bucket.longhorn_backup_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "longhorn_backup_logs" {
  bucket = aws_s3_bucket.longhorn_backup_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_logging" "longhorn_backup" {
  bucket        = aws_s3_bucket.longhorn_backup.id
  target_bucket = aws_s3_bucket.longhorn_backup_logs.id
  target_prefix = "access-logs/"
}
