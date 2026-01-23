output "role_arn" {
  description = "The ARN of the GitHub Actions Ansible IAM role"
  value       = aws_iam_role.github_actions_ansible.arn
}

output "role_name" {
  description = "The name of the GitHub Actions Ansible IAM role"
  value       = aws_iam_role.github_actions_ansible.name
}
