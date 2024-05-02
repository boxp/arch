data "aws_iam_policy_document" "hitohub_prod_gha_assume_role_policy" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com"] # ID プロバイダの ARN
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # 特定のリポジトリの特定のブランチからのみ認証を許可する
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:boxp/vr-match:ref:refs/heads/master"]
    }
  }
}

resource "aws_iam_role" "hitohub_prod_gha_role" {
  name               = "hitohub-prod-gha-role"
  assume_role_policy = data.aws_iam_policy_document.hitohub_prod_gha_assume_role_policy.json
}

# ecr:GetAuthorizationToken が リソースレベルのアクセス許可をサポートしていないため、全リソースに対して許可する
#trivy:ignore:AVD-AWS-0057
resource "aws_iam_policy" "hitohub_prod_gha_policy" {
  name        = "hitohub-prod-gha-policy"
  path        = "/"
  description = "Policy for hitohub prod GitHub Actions"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Effect   = "Allow"
        Resource = "arn:aws:ecr:ap-northeast-1:${var.aws_account_id}:repository/hitohub-*-prod"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
    ]
  })
}

# 任意のポリシーをアタッチする
# AmazonS3ReadOnlyAccess をアタッチする例
resource "aws_iam_role_policy_attachment" "hitohubprod_gha_policy_attachment" {
  role       = aws_iam_role.hitohub_prod_gha_role.name
  policy_arn = aws_iam_policy.hitohub_prod_gha_policy.arn
}
