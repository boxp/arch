data "aws_iam_policy_document" "even_g2_lab_main_gha_assume_role_policy" {
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
      values   = ["repo:boxp/even-g2-lab:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "even_g2_lab_main_gha_role" {
  name               = "even-g2-lab-main-gha-role"
  assume_role_policy = data.aws_iam_policy_document.even_g2_lab_main_gha_assume_role_policy.json
}

# ecr:GetAuthorizationToken does not support resource-level permissions.
#trivy:ignore:AWS-0057
resource "aws_iam_policy" "even_g2_lab_main_gha_policy" {
  name        = "even-g2-lab-main-gha-policy"
  path        = "/"
  description = "Policy for even-g2-lab main image GitHub Actions"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Effect   = "Allow"
        Resource = aws_ecr_repository.even_g2_client_main.arn
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

resource "aws_iam_role_policy_attachment" "even_g2_lab_main_gha_policy_attachment" {
  role       = aws_iam_role.even_g2_lab_main_gha_role.name
  policy_arn = aws_iam_policy.even_g2_lab_main_gha_policy.arn
}
