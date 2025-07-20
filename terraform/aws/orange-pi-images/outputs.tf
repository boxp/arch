output "s3_bucket_name" {
  description = "Name of the S3 bucket for Orange Pi images"
  value       = aws_s3_bucket.orange_pi_images.bucket
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket for Orange Pi images"
  value       = aws_s3_bucket.orange_pi_images.arn
}

output "github_actions_role_arn" {
  description = "ARN of the GitHub Actions IAM role for Orange Pi builds"
  value       = aws_iam_role.github_actions_orangepi_build.arn
}

output "github_actions_role_name" {
  description = "Name of the GitHub Actions IAM role for Orange Pi builds"
  value       = aws_iam_role.github_actions_orangepi_build.name
}