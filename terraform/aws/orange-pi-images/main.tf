# S3 bucket for storing Orange Pi images
resource "aws_s3_bucket" "orange_pi_images" {
  bucket = "arch-orange-pi-images-${random_id.bucket_suffix.hex}"
}

# Block all public access to the bucket
resource "aws_s3_bucket_public_access_block" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket_versioning" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id
  versioning_configuration {
    status = "Enabled"
  }
}

# KMS key for S3 encryption
resource "aws_kms_key" "orange_pi_images" {
  description             = "KMS key for Orange Pi images S3 bucket"
  deletion_window_in_days = 7

  tags = {
    Name = "orange-pi-images-key"
  }
}

resource "aws_kms_alias" "orange_pi_images" {
  name          = "alias/orange-pi-images"
  target_key_id = aws_kms_key.orange_pi_images.key_id
}

resource "aws_s3_bucket_server_side_encryption_configuration" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.orange_pi_images.arn
    }
    bucket_key_enabled = true
  }
}

# S3 bucket for access logs
resource "aws_s3_bucket" "orange_pi_images_logs" {
  bucket = "arch-orange-pi-images-logs-${random_id.bucket_suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "orange_pi_images_logs" {
  bucket = aws_s3_bucket.orange_pi_images_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  target_bucket = aws_s3_bucket.orange_pi_images_logs.id
  target_prefix = "access-logs/"
}

resource "aws_s3_bucket_lifecycle_configuration" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  # Shanghai-1 node lifecycle rule
  rule {
    id     = "cleanup_shanghai_1_images"
    status = "Enabled"

    filter {
      prefix = "images/orange-pi-zero3/shanghai-1/"
    }

    noncurrent_version_expiration {
      newer_noncurrent_versions = 3
      noncurrent_days          = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Shanghai-2 node lifecycle rule
  rule {
    id     = "cleanup_shanghai_2_images"
    status = "Enabled"

    filter {
      prefix = "images/orange-pi-zero3/shanghai-2/"
    }

    noncurrent_version_expiration {
      newer_noncurrent_versions = 3
      noncurrent_days          = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Shanghai-3 node lifecycle rule
  rule {
    id     = "cleanup_shanghai_3_images"
    status = "Enabled"

    filter {
      prefix = "images/orange-pi-zero3/shanghai-3/"
    }

    noncurrent_version_expiration {
      newer_noncurrent_versions = 3
      noncurrent_days          = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # General cleanup for other paths
  rule {
    id     = "cleanup_general"
    status = "Enabled"

    filter {
      prefix = "images/"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# IAM role for GitHub Actions
resource "aws_iam_role" "github_actions_orangepi" {
  name = "github-actions-orangepi-images"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
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

resource "aws_iam_role_policy" "github_actions_orangepi_s3" {
  name = "orangepi-images-s3-policy"
  role = aws_iam_role.github_actions_orangepi.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:PutObjectTagging"
        ]
        Resource = "${aws_s3_bucket.orange_pi_images.arn}/images/orange-pi-zero3/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.orange_pi_images.arn
        Condition = {
          StringLike = {
            "s3:prefix" = "images/orange-pi-zero3/*"
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.orange_pi_images.arn
      }
    ]
  })
}

# IAM policy for boxp user access to Orange Pi images bucket
resource "aws_iam_policy" "boxp_orangepi_images_access" {
  name        = "boxp-orangepi-images-access"
  description = "Allow boxp user to access Orange Pi images bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.orange_pi_images.arn,
          "${aws_s3_bucket.orange_pi_images.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.orange_pi_images.arn
      }
    ]
  })
}

# Attach policy to boxp user
resource "aws_iam_user_policy_attachment" "boxp_orangepi_images_access" {
  user       = "boxp"
  policy_arn = aws_iam_policy.boxp_orangepi_images_access.arn
}

data "aws_caller_identity" "current" {}

# Store bucket name in SSM for easy reference
resource "aws_ssm_parameter" "orange_pi_bucket_name" {
  name  = "/arch/orange-pi/s3-bucket-name"
  type  = "String"
  value = aws_s3_bucket.orange_pi_images.bucket
}

resource "aws_ssm_parameter" "github_actions_role_arn" {
  name  = "/arch/orange-pi/github-actions-role-arn"
  type  = "String"
  value = aws_iam_role.github_actions_orangepi.arn
}