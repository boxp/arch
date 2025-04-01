terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0" # Adjust based on project standards if known
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.9" # Adjust based on project standards if known
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1" # Adjust based on project standards if known
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0" # Adjust based on project standards if known
    }
  }
}

provider "cloudflare" {
  # token pulled from $CLOUDFLARE_API_TOKEN
}

provider "aws" {
  region = "ap-northeast-1" # Assuming same region as argocd
}

provider "random" {
}
