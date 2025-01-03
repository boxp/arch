terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/k8s/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 4"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
  }
}
