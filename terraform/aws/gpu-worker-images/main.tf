# S3 bucket for storing GPU worker images
resource "aws_s3_bucket" "gpu_worker_images" {
  bucket = "arch-gpu-worker-images"
}

resource "aws_s3_bucket_public_access_block" "gpu_worker_images" {
  bucket = aws_s3_bucket.gpu_worker_images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "gpu_worker_images" {
  bucket = aws_s3_bucket.gpu_worker_images.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "gpu_worker_images" {
  bucket = aws_s3_bucket.gpu_worker_images.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

# S3 bucket for access logs
resource "aws_s3_bucket" "gpu_worker_images_logs" {
  bucket = "arch-gpu-worker-images-logs"
}

resource "aws_s3_bucket_public_access_block" "gpu_worker_images_logs" {
  bucket = aws_s3_bucket.gpu_worker_images_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "gpu_worker_images" {
  bucket = aws_s3_bucket.gpu_worker_images.id

  target_bucket = aws_s3_bucket.gpu_worker_images_logs.id
  target_prefix = "access-logs/"
}

resource "aws_s3_bucket_lifecycle_configuration" "gpu_worker_images" {
  bucket = aws_s3_bucket.gpu_worker_images.id

  rule {
    id     = "cleanup_gpu_worker_timestamped_artifacts"
    status = "Enabled"

    filter {
      prefix = "images/artifacts/"
    }

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "cleanup_noncurrent_versions"
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

resource "aws_iam_role" "github_actions_gpu_worker_image_build" {
  name = "GitHubActions_GPUWorkerImage_Build"

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

resource "aws_iam_role_policy" "github_actions_gpu_worker_images_s3" {
  name = "gpu-worker-images-s3-policy"
  role = aws_iam_role.github_actions_gpu_worker_image_build.id

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
        Resource = "${aws_s3_bucket.gpu_worker_images.arn}/images/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.gpu_worker_images.arn
        Condition = {
          StringLike = {
            "s3:prefix" = "images/*"
          }
        }
      }
    ]
  })
}

resource "aws_iam_policy" "boxp_gpu_worker_images_access" {
  name        = "boxp-gpu-worker-images-access"
  description = "Allow boxp user to access GPU worker images bucket"

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
          aws_s3_bucket.gpu_worker_images.arn,
          "${aws_s3_bucket.gpu_worker_images.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "boxp_gpu_worker_images_access" {
  user       = "boxp"
  policy_arn = aws_iam_policy.boxp_gpu_worker_images_access.arn
}

data "aws_caller_identity" "current" {}
