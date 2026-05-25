resource "aws_s3_bucket" "etcd_snapshots" {
  bucket = "arch-etcd-snapshots"
}

resource "aws_s3_bucket_public_access_block" "etcd_snapshots" {
  bucket = aws_s3_bucket.etcd_snapshots.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "etcd_snapshots" {
  bucket = aws_s3_bucket.etcd_snapshots.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "etcd_snapshots" {
  bucket = aws_s3_bucket.etcd_snapshots.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "etcd_snapshots" {
  bucket = aws_s3_bucket.etcd_snapshots.id

  rule {
    id     = "expire-etcd-snapshots"
    status = "Enabled"

    filter {
      prefix = "kubernetes-upgrade/"
    }

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_iam_policy" "etcd_snapshot_s3_write" {
  name        = "GitHubActions_Ansible_EtcdSnapshotS3Write"
  path        = "/"
  description = "Allow GitHub Actions Ansible role to write Kubernetes etcd snapshots to S3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation"
        ]
        Resource = aws_s3_bucket.etcd_snapshots.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.etcd_snapshots.arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "kubernetes-upgrade/*"
            ]
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.etcd_snapshots.arn}/kubernetes-upgrade/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_ansible_etcd_snapshot_s3_write" {
  role       = aws_iam_role.github_actions_ansible.name
  policy_arn = aws_iam_policy.etcd_snapshot_s3_write.arn
}
