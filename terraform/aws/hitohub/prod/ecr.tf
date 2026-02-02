resource "aws_ecr_repository" "hitohub_backend_prod" {
  name                 = "hitohub-backend-prod"
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


resource "aws_ecr_lifecycle_policy" "hitohub_backend_prod_lifecycle_policy" {
  repository = aws_ecr_repository.hitohub_backend_prod.name

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

resource "aws_ecr_repository" "hitohub_frontend_prod" {
  name                 = "hitohub-frontend-prod"
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


resource "aws_ecr_lifecycle_policy" "hitohub_frontend_prod_lifecycle_policy" {
  repository = aws_ecr_repository.hitohub_frontend_prod.name

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
