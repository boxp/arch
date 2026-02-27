terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/tailscale/lolice/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    # NOTE: Add tailscale provider when TAILSCALE_API_KEY and
    # TAILSCALE_TAILNET are configured as GitHub Secrets.
    # tailscale = {
    #   source  = "tailscale/tailscale"
    #   version = "0.28.0"
    # }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
