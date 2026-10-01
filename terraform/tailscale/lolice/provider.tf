provider "tailscale" {
  # Authentication is supplied by the execution environment through WIF:
  # TAILSCALE_OAUTH_CLIENT_ID + TAILSCALE_AUDIENCE (v0.29.2 discovers GitHub
  # OIDC). The tfaction plan and apply jobs set both from the non-secret client
  # ID variables and pass no API key (docs/project_docs/BOXP-200/runbook.md).
}

provider "aws" {
  region = "ap-northeast-1"
}
