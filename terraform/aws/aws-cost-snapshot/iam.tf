data "aws_iam_policy_document" "aws_cost_snapshot_gha_assume_role_policy" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:boxp/arch:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "aws_cost_snapshot_gha_role" {
  name               = "aws-cost-snapshot-gha-role"
  assume_role_policy = data.aws_iam_policy_document.aws_cost_snapshot_gha_assume_role_policy.json
}

# Cost Explorer actions do not support resource-level permissions.
#trivy:ignore:AWS-0057
resource "aws_iam_policy" "aws_cost_snapshot" {
  name = "aws-cost-snapshot-gha-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ce:GetCostAndUsage", "ce:GetCostForecast"], Resource = "*" },
      { Effect = "Allow", Action = ["ssm:PutParameter", "ssm:GetParameter"], Resource = "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/lolice/aws-cost/*" },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "aws_cost_snapshot" {
  role       = aws_iam_role.aws_cost_snapshot_gha_role.name
  policy_arn = aws_iam_policy.aws_cost_snapshot.arn
}
