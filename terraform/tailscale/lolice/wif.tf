# Workload Identity Federation (WIF) Trust Credential
# Allows GitHub Actions in boxp/lolice to authenticate to the tailnet
# via OIDC token exchange (keyless).
resource "tailscale_federated_identity" "github_actions_argocd_diff" {
  # GitHub Actions OIDC issuer
  issuer = "https://token.actions.githubusercontent.com"

  # Subject: restrict to pull_request events from the target repository
  subject = "repo:${var.github_repository}:pull_request"

  # Scopes granted to tokens generated via this trust credential
  scopes = ["auth_keys", "devices:core"]

  # Tags assigned to ephemeral nodes created via this trust credential
  # Required when scopes include "devices:core" or "auth_keys"
  tags = ["tag:ci"]

  # Custom claim rules to further restrict to the specific workflow
  custom_claim_rules = {
    workflow = var.argocd_diff_workflow_name
  }
}
