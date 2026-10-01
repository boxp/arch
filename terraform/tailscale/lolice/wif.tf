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

# Production tfaction plan/tfmigrate plan on PRs. pull_request_target runs the
# base-branch workflow against PR code, so this identity stays read-only.
resource "tailscale_federated_identity" "github_actions_arch_ci_plan" {
  description = "GitHub Actions arch tfaction plan read only"
  issuer      = "https://token.actions.githubusercontent.com"
  # GitHub does not document the sub format for pull_request_target, so match
  # the repository here and pin the event and base-branch workflows below.
  subject = "repo:boxp/arch:*"

  scopes = [
    "policy_file:read",
    "devices:core:read",
    "devices:posture_attributes:read",
    "auth_keys:read",
    "federated_keys:read",
  ]
  tags = ["tag:subnet-router"]

  custom_claim_rules = {
    repository       = "boxp/arch"
    event_name       = "pull_request_target"
    workflow_ref     = "boxp/arch/.github/workflows/test.yaml@refs/heads/main"
    job_workflow_ref = "boxp/arch/.github/workflows/wc-plan.yaml@refs/heads/main"
  }

  depends_on = [tailscale_acl.this]
}

# Production tfaction apply/tfmigrate apply. Only the apply workflow on pushes
# to main can use the write scopes this module needs (ACL, auth key, trusts).
resource "tailscale_federated_identity" "github_actions_arch_apply" {
  description = "GitHub Actions arch tfaction apply"
  issuer      = "https://token.actions.githubusercontent.com"
  subject     = "repo:boxp/arch:ref:refs/heads/main"

  # policy_file requires devices:posture_attributes and devices:core:read.
  scopes = [
    "policy_file",
    "devices:core:read",
    "devices:posture_attributes",
    "auth_keys",
    "federated_keys",
  ]
  # Tags this module assigns to the auth key and trust credentials it manages.
  tags = ["tag:subnet-router", "tag:ci"]

  custom_claim_rules = {
    repository   = "boxp/arch"
    ref          = "refs/heads/main"
    event_name   = "push"
    workflow_ref = "boxp/arch/.github/workflows/apply.yaml@refs/heads/main"
  }

  depends_on = [tailscale_acl.this]
}
