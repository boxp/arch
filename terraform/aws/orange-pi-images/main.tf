# S3 bucket for storing Orange Pi images
resource "aws_s3_bucket" "orange_pi_images" {
  bucket = "arch-orange-pi-images-${random_id.bucket_suffix.hex}"
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

resource "aws_s3_bucket_server_side_encryption_configuration" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "orange_pi_images" {
  bucket = aws_s3_bucket.orange_pi_images.id

  rule {
    id     = "cleanup_old_versions"
    status = "Enabled"

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