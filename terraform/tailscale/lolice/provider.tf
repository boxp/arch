provider "tailscale" {
  # Authentication is supplied by the execution environment.
  # WIF: TAILSCALE_OAUTH_CLIENT_ID + TAILSCALE_AUDIENCE (v0.29.2 discovers
  # GitHub OIDC). Do not supply TAILSCALE_API_KEY at the same time.
  # tfaction plan and apply jobs select WIF when the client ID variables are
  # registered and fall back to the API key when they are deleted
  # (docs/project_docs/BOXP-200/runbook.md).
}

provider "aws" {
  region = "ap-northeast-1"
}
