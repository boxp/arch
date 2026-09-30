provider "tailscale" {
  # Authentication is supplied by the execution environment.
  # WIF candidate: TAILSCALE_OAUTH_CLIENT_ID + TAILSCALE_AUDIENCE (v0.29.2
  # discovers GitHub OIDC). Do not supply TAILSCALE_API_KEY at the same time.
  # Legacy tfaction jobs retain API-key authentication until verified cutover.
}

provider "aws" {
  region = "ap-northeast-1"
}
