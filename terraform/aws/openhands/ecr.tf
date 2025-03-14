# OpenHandsランタイムイメージ用のECRリポジトリ
resource "aws_ecr_repository" "openhands_runtime" {
  name                 = "openhands-runtime"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  # terraform planが非常に不安定になったのでkms keyはdefaultにする
  #trivy:ignore:AVD-AWS-0033
  encryption_configuration {
    encryption_type = "KMS"
  }
}

# リポジトリのライフサイクルポリシー - 古いイメージを自動的に削除
resource "aws_ecr_lifecycle_policy" "openhands_runtime_lifecycle" {
  repository = aws_ecr_repository.openhands_runtime.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "limit the number of images to 3"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}