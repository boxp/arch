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

resource "aws_s3_bucket_lifecycle_configuration" "longhorn_backup" {
  bucket = aws_s3_bucket.longhorn_backup.id

  depends_on = [aws_s3_bucket_versioning.longhorn_backup]

  rule {
    id     = "expire-noncurrent-longhorn-backupstore"
    status = "Enabled"

    filter {
      prefix = "backupstore/"
    }

    noncurrent_version_expiration {
      # Retention days are an Owner decision (BOXP-598); 14 is the proposed value.
      noncurrent_days = 14
    }

    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
