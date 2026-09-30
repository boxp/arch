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

  # ACL must be applied first so that tag:ci is recognised.
  depends_on = [tailscale_acl.this]
}

# Bootstrap with the existing authentication before configuring the candidate
# workflow. This read-only identity cannot create or rotate other credentials.
resource "tailscale_federated_identity" "github_actions_arch_plan" {
  description = "GitHub Actions arch read only plan"
  issuer      = "https://token.actions.githubusercontent.com"
  subject     = "repo:boxp/arch:ref:refs/heads/main"

  # Omit audience so Tailscale generates it; expose only that non-secret value.
  scopes = [
    "policy_file:read",
    "devices:core:read",
    "devices:posture_attributes:read",
    "auth_keys:read",
    "federated_keys:read",
  ]
  tags = ["tag:subnet-router"]

  custom_claim_rules = {
    repository   = "boxp/arch"
    ref          = "refs/heads/main"
    event_name   = "workflow_dispatch"
    workflow_ref = "boxp/arch/.github/workflows/tailscale-wif-plan.yaml@refs/heads/main"
  }

  depends_on = [tailscale_acl.this]
}
