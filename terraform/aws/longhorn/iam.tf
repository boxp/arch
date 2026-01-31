# IAM User for Longhorn S3 backup access
resource "aws_iam_user" "longhorn_backup" {
  name = "longhorn-backup-user"
  path = "/system/"

  tags = {
    Description = "User for Longhorn S3 backup access"
    Project     = "lolice"
  }
}

resource "aws_iam_group" "longhorn_backup" {
  name = "longhorn-backup-group"
  path = "/system/"
}

resource "aws_iam_group_membership" "longhorn_backup" {
  name  = "longhorn-backup-membership"
  users = [aws_iam_user.longhorn_backup.name]
  group = aws_iam_group.longhorn_backup.name
}

resource "aws_iam_policy" "longhorn_backup" {
  name = "longhorn-backup-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = aws_s3_bucket.longhorn_backup.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.longhorn_backup.arn}/*"
      }
    ]
  })
}

resource "aws_iam_group_policy_attachment" "longhorn_backup" {
  group      = aws_iam_group.longhorn_backup.name
  policy_arn = aws_iam_policy.longhorn_backup.arn
}

resource "aws_iam_access_key" "longhorn_backup" {
  user = aws_iam_user.longhorn_backup.name
}
