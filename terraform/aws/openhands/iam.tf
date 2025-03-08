resource "aws_iam_user" "bedrock_user" {
  name = "bedrock-openhands-user"
  path = "/service/"
}

resource "aws_iam_access_key" "bedrock_user_key" {
  user = aws_iam_user.bedrock_user.name
}

# カスタムポリシーの作成（最小権限の原則に基づく）
resource "aws_iam_policy" "bedrock_policy" {
  name        = "bedrock-openhands-policy"
  description = "Policy for accessing AWS Bedrock Claude 3.7 Sonnet"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:GetModelCustomizationJob",
          "bedrock:ListModelCustomizationJobs",
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel"
        ]
        Resource = [
          "arn:aws:bedrock:${var.bedrock_region}:${var.account_id}:inference-profile/${var.bedrock_model_id}",
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0"
        ]
      }
    ]
  })
}

# ポリシーをIAMユーザーにアタッチ
resource "aws_iam_user_policy_attachment" "bedrock_policy_attachment" {
  user       = aws_iam_user.bedrock_user.name
  policy_arn = aws_iam_policy.bedrock_policy.arn
} 