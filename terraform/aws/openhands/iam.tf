# SSMパラメータ読み取り用のIAMユーザー
resource "aws_iam_user" "ssm_reader_user" {
  name = "ssm-reader-openhands-user"
  path = "/service/"
}

resource "aws_iam_access_key" "ssm_reader_user_key" {
  user = aws_iam_user.ssm_reader_user.name
}

# SSMパラメータ読み取り用のポリシー
resource "aws_iam_policy" "ssm_reader_policy" {
  name        = "ssm-reader-openhands-policy"
  description = "Policy for reading SSM parameters"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:DescribeParameters"
        ]
        Resource = [
          "arn:aws:ssm:${var.region}:${var.account_id}:parameter/*"
        ]
      }
    ]
  })
}

# ポリシーをIAMユーザーにアタッチ
resource "aws_iam_user_policy_attachment" "ssm_reader_policy_attachment" {
  user       = aws_iam_user.ssm_reader_user.name
  policy_arn = aws_iam_policy.ssm_reader_policy.arn
}
