resource "aws_ecr_repository" "palserver" {
  name                 = "palserver"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  # terraform planが非常に不安定になったのでkms keyはdefaultにする
  #trivy:ignore:AWS-0033
  encryption_configuration {
    encryption_type = "KMS"
  }
}


resource "aws_ecr_lifecycle_policy" "palserver_lifecycle_policy" {
  repository = aws_ecr_repository.palserver.name

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
