provider "tailscale" {
  # api_key and tailnet pulled from $TAILSCALE_API_KEY and $TAILSCALE_TAILNET
}

provider "aws" {
  region = "ap-northeast-1"
}
