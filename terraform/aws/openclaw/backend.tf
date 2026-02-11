terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/aws/openclaw/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
