terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "%%TARGET%%/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "0.28.0"
    }
  }
}
