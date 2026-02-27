# Workload Identity Federation (WIF) Trust Credential
# Allows GitHub Actions in boxp/lolice to authenticate to the tailnet
# via OIDC token exchange (keyless).
#
# NOTE: Uncomment when TAILSCALE_API_KEY and TAILSCALE_TAILNET are configured.
# resource "tailscale_federated_identity" "github_actions_argocd_diff" {
#   # GitHub Actions OIDC issuer
#   issuer = "https://token.actions.githubusercontent.com"
#
#   # Subject: restrict to pull_request events from the target repository
#   subject = "repo:${var.github_repository}:pull_request"
#
#   # Tags assigned to ephemeral nodes created via this trust credential
#   tags = ["tag:ci"]
#
#   # Custom claim rules to further restrict to the specific workflow
#   claim_mappings = {
#     workflow = var.argocd_diff_workflow_name
#   }
# }
