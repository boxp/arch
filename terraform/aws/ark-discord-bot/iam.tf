data "aws_iam_policy_document" "ark_discord_bot_gha_assume_role_policy" {
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
      values   = ["repo:boxp/ark-discord-bot:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "ark_discord_bot_gha_role" {
  name               = "ark-discord-bot-gha-role"
  assume_role_policy = data.aws_iam_policy_document.ark_discord_bot_gha_assume_role_policy.json
}

# ecr:GetAuthorizationToken が リソースレベルのアクセス許可をサポートしていないため、全リソースに対して許可する
#trivy:ignore:AWS-0057
resource "aws_iam_policy" "ark_discord_bot_gha_policy" {
  name        = "ark-discord-bot-gha-policy"
  path        = "/"
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
        Resource = "arn:aws:ecr:ap-northeast-1:${var.aws_account_id}:repository/ark-discord-bot"
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
          "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/lolice/ark-discord-bot/DISCORD_BOT_TOKEN",
          "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/lolice/ark-discord-bot/DISCORD_CHANNEL_ID",
          "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/lolice/ark-discord-bot/RCON_PASSWORD"
        ]
      }
    ]
  })
}

# ポリシーをロールにアタッチ
resource "aws_iam_role_policy_attachment" "ark_discord_bot_gha_policy_attachment" {
  role       = aws_iam_role.ark_discord_bot_gha_role.name
  policy_arn = aws_iam_policy.ark_discord_bot_gha_policy.arn
}