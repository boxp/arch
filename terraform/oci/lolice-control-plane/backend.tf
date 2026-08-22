terraform {
  required_version = ">= 1.0"
  backend "s3" {
    bucket = "tfaction-state"
    key    = "terraform/oci/lolice-control-plane/v1/terraform.tfstate"
    region = "ap-northeast-1"
  }

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
