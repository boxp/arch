output "s3_bucket_name" {
  description = "Name of the S3 bucket for Orange Pi images"
  value       = aws_s3_bucket.orange_pi_images.bucket
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket for Orange Pi images"
  value       = aws_s3_bucket.orange_pi_images.arn
}

output "github_actions_role_arn" {
  description = "ARN of the IAM role for GitHub Actions"
  value       = aws_iam_role.github_actions_orangepi.arn
}

output "github_actions_role_name" {
  description = "Name of the IAM role for GitHub Actions"
  value       = aws_iam_role.github_actions_orangepi.name
}