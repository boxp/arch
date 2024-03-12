resource "aws_kms_key" "ecr_kms" {
  enable_key_rotation = true
}

resource "aws_ecr_repository" "palserver" {
  name                 = "palserver"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.ecr_kms.key_id
  }
}
