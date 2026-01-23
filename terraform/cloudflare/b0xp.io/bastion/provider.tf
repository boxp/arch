provider "cloudflare" {
  # token pulled from $CLOUDFLARE_API_TOKEN
}

provider "aws" {
  region = "ap-northeast-1"
}

provider "random" {
}

provider "time" {
}
