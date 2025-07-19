terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/kubernetes-dashboard/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 4.52.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
