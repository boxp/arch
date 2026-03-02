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

# ── Kubernetes Operator WIF Trust Credential ─────────────────────────
# Allows the tailscale-operator Pod to authenticate to the tailnet
# using a projected ServiceAccount OIDC token (no client secret needed).
# The OIDC issuer is the S3-hosted discovery endpoint for the lolice
# kubeadm cluster (see oidc.tf).
resource "tailscale_federated_identity" "k8s_operator" {
  description = "lolice k8s-operator WIF"

  # OIDC issuer: S3-hosted discovery for the kubeadm cluster
  issuer = local.oidc_issuer_url

  # Subject: the operator ServiceAccount in the tailscale-operator namespace
  subject = "system:serviceaccount:tailscale-operator:operator"

  # Scopes required by the Kubernetes Operator
  scopes = ["auth_keys", "devices:core", "services"]

  # Tag assigned to the operator node
  tags = ["tag:k8s-operator"]

  # ACL must exist so tag:k8s-operator is recognised, and the S3
  # OIDC discovery docs must be published before Tailscale validates
  # the issuer URL.
  depends_on = [
    tailscale_acl.this,
    aws_s3_object.oidc_discovery,
    aws_s3_object.oidc_jwks,
    aws_s3_bucket_policy.k8s_oidc_public_read,
  ]
}
