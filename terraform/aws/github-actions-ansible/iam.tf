data "aws_iam_policy_document" "github_actions_ansible_assume_role_policy" {
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

    # Allow from main branch only
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:boxp/arch:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions_ansible" {
  name               = "GitHubActions_Ansible_Apply"
  assume_role_policy = data.aws_iam_policy_document.github_actions_ansible_assume_role_policy.json
}

resource "aws_iam_policy" "ssm_read" {
  name        = "GitHubActions_Ansible_SSMRead"
  path        = "/"
  description = "Policy for GitHub Actions Ansible to read SSM parameters for Cloudflare bastion access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = [
          "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/bastion-*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_ansible_ssm_read" {
  role       = aws_iam_role.github_actions_ansible.name
  policy_arn = aws_iam_policy.ssm_read.arn
}

# Plan role for PR (read-only operations with --check --diff)
data "aws_iam_policy_document" "github_actions_ansible_plan_assume_role_policy" {
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

    # Allow from pull requests
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:boxp/arch:pull_request"]
    }
  }
}

resource "aws_iam_role" "github_actions_ansible_plan" {
  name               = "GitHubActions_Ansible_Plan"
  assume_role_policy = data.aws_iam_policy_document.github_actions_ansible_plan_assume_role_policy.json
}

resource "aws_iam_role_policy_attachment" "github_actions_ansible_plan_ssm_read" {
  role       = aws_iam_role.github_actions_ansible_plan.name
  policy_arn = aws_iam_policy.ssm_read.arn
}
