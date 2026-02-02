# External Secret OperatorがSSMを読み取るためのIAMポリシー
# 動的にパラメータが増えるのでワイルドカードを許容する
#trivy:ignore:AWS-0057
resource "aws_iam_policy" "external_secret_policy" {
  name        = "external_secret_policy"
  description = "Policy for accessing SSM parameters"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      Resource = [
        "*",
      ]
    }]
  })
}

# External Secret OperatorがアタッチするIAMロール
resource "aws_iam_role" "external_secrets_role" {
  name = "external_secrets_role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = {
        AWS = "*"
      },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "external_secrets_policy_attachment" {
  role       = aws_iam_role.external_secrets_role.name
  policy_arn = aws_iam_policy.external_secret_policy.arn
}

# External Secret Operatorが利用するIAMユーザー
resource "aws_iam_user" "external_secrets_user" {
  name = "external_secrets_user"
}
