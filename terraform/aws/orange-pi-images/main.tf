# S3 bucket for storing Orange Pi images
resource "aws_s3_bucket" "orange_pi_images" {
  bucket = "arch-orange-pi-images"
}

# Block all public access to the bucket
resource "aws_s3_bucket_public_access_block" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
      # Use AWS managed key for S3 (aws/s3)
    }
    bucket_key_enabled = true
  }
}

# S3 bucket for access logs
resource "aws_s3_bucket" "orange_pi_images_logs" {
  bucket = "arch-orange-pi-images-logs"
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

  # Shanghai-1 node lifecycle rule - delete old timestamped images after 14 days
  rule {
    id     = "cleanup_shanghai_1_images"
    status = "Enabled"

    filter {
      prefix = "images/orange-pi-zero3/shanghai-1/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      newer_noncurrent_versions = 6
      noncurrent_days           = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Shanghai-2 node lifecycle rule - delete old timestamped images after 14 days
  rule {
    id     = "cleanup_shanghai_2_images"
    status = "Enabled"

    filter {
      prefix = "images/orange-pi-zero3/shanghai-2/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      newer_noncurrent_versions = 6
      noncurrent_days           = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Shanghai-3 node lifecycle rule - delete old timestamped images after 14 days
  rule {
    id     = "cleanup_shanghai_3_images"
    status = "Enabled"

    filter {
      prefix = "images/orange-pi-zero3/shanghai-3/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      newer_noncurrent_versions = 6
      noncurrent_days           = 1
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

# Create dedicated IAM role for Orange Pi image builds
resource "aws_iam_role" "github_actions_orangepi_build" {
  name = "GitHubActions_OrangePi_Build"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
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

# S3 access policy for Orange Pi image builds
resource "aws_iam_role_policy" "github_actions_orangepi_s3" {
  name = "orangepi-images-s3-policy"
  role = aws_iam_role.github_actions_orangepi_build.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:PutObjectTagging",
          "s3:GetObject"
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

