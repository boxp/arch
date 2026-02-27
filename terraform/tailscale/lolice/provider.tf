# NOTE: Uncomment when TAILSCALE_API_KEY and TAILSCALE_TAILNET are configured
# as GitHub Secrets and added to tfaction-root.yaml secrets config.
# provider "tailscale" {
#   # api_key and tailnet pulled from $TAILSCALE_API_KEY and $TAILSCALE_TAILNET
# }

provider "aws" {
  region = "ap-northeast-1"
}
