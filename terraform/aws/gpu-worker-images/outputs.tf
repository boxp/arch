output "s3_bucket_name" {
  description = "Name of the S3 bucket for GPU worker images"
  value       = aws_s3_bucket.gpu_worker_images.bucket
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket for GPU worker images"
  value       = aws_s3_bucket.gpu_worker_images.arn
}

output "github_actions_role_arn" {
  description = "ARN of the GitHub Actions IAM role for GPU worker image builds"
  value       = aws_iam_role.github_actions_gpu_worker_image_build.arn
}

output "github_actions_role_name" {
  description = "Name of the GitHub Actions IAM role for GPU worker image builds"
  value       = aws_iam_role.github_actions_gpu_worker_image_build.name
}
