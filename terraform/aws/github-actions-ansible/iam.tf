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
  description = "Policy for GitHub Actions Ansible to read SSM parameters"

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
          "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/bastion-*",
          "arn:aws:ssm:ap-northeast-1:${var.aws_account_id}:parameter/ansible-*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_ansible_ssm_read" {
  role       = aws_iam_role.github_actions_ansible.name
  policy_arn = aws_iam_policy.ssm_read.arn
}
