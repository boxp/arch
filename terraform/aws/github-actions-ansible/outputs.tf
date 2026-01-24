output "role_arn" {
  description = "The ARN of the GitHub Actions Ansible Apply IAM role"
  value       = aws_iam_role.github_actions_ansible.arn
}

output "role_name" {
  description = "The name of the GitHub Actions Ansible Apply IAM role"
  value       = aws_iam_role.github_actions_ansible.name
}

output "plan_role_arn" {
  description = "The ARN of the GitHub Actions Ansible Plan IAM role"
  value       = aws_iam_role.github_actions_ansible_plan.arn
}

output "plan_role_name" {
  description = "The name of the GitHub Actions Ansible Plan IAM role"
  value       = aws_iam_role.github_actions_ansible_plan.name
}
