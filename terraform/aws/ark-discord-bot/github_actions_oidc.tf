# GitHub ActionsのOIDCプロバイダーが利用するIAMロールのための信頼ポリシー
data "aws_iam_policy_document" "ark_discord_bot_gha_assume_role_policy" {
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
      values   = ["repo:boxp/ark-discord-bot:ref:refs/heads/main"]
    }
  }
}

# GitHub Actions用のIAMロール
resource "aws_iam_role" "ark_discord_bot_role" {
  name               = "ark-discord-bot-role"
  assume_role_policy = data.aws_iam_policy_document.ark_discord_bot_gha_assume_role_policy.json
}

# GitHub Actions用のポリシー（ECRとSSMパラメータストアへのアクセス）
resource "aws_iam_policy" "ark_discord_bot_policy" {
  name        = "ark-discord-bot-policy"
  description = "Policy for ARK Discord Bot GitHub Actions"

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
        Resource = "arn:aws:ecr:${var.region}:${var.account_id}:repository/ark-discord-bot"
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
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/parameter-reader-access-key-id",
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/parameter-reader-secret-access-key"
        ]
      }
    ]
  })
}

# ポリシーをロールにアタッチ
resource "aws_iam_role_policy_attachment" "ark_discord_bot_policy_attachment" {
  role       = aws_iam_role.ark_discord_bot_role.name
  policy_arn = aws_iam_policy.ark_discord_bot_policy.arn
}