# GitHub ActionsのOIDCプロバイダーが利用するIAMロールのための信頼ポリシー
data "aws_iam_policy_document" "openhands_runtime_gha_assume_role_policy" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"]
    }

    # audience条件 - GitHub Actionsが使用する標準値
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # subject条件 - リポジトリとブランチを制限
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:boxp/openhands-runtime:ref:refs/heads/main"]
    }
  }
}

# GitHub Actions用のIAMロール
resource "aws_iam_role" "openhands_runtime_role" {
  name               = "openhands-runtime-role"
  assume_role_policy = data.aws_iam_policy_document.openhands_runtime_gha_assume_role_policy.json
}

# GitHub Actions用のポリシー（ECRとSSMパラメータストアへのアクセス）
resource "aws_iam_policy" "openhands_runtime_policy" {
  name        = "openhands-runtime-policy"
  description = "Policy for OpenHands Runtime GitHub Actions"

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
        Resource = "arn:aws:ecr:${var.region}:${var.account_id}:repository/openhands-runtime"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = [
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/parameter-reader-*"
        ]
      }
    ]
  })
}

# ポリシーをロールにアタッチ
resource "aws_iam_role_policy_attachment" "openhands_runtime_policy_attachment" {
  role       = aws_iam_role.openhands_runtime_role.name
  policy_arn = aws_iam_policy.openhands_runtime_policy.arn
} 