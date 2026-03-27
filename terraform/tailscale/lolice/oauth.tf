# OAuth credentials for the Tailscale Kubernetes Operator.
#
# The Tailscale Terraform provider (v0.28) does not support creating
# OAuth clients.  Create the client manually in the Tailscale admin
# console (Settings > OAuth clients) with at minimum:
#   - Write scope on "auth_keys" and "devices"
#   - Tag: tag:k8s-operator
#
# After the first `terraform apply`, update the two SSM parameters
# with the real values via the AWS console or CLI:
#
#   aws ssm put-parameter --name "/lolice/tailscale/operator-oauth-client-id" \
#       --value "<REAL_CLIENT_ID>" --type SecureString --overwrite
#   aws ssm put-parameter --name "/lolice/tailscale/operator-oauth-client-secret" \
#       --value "<REAL_CLIENT_SECRET>" --type SecureString --overwrite

resource "aws_ssm_parameter" "operator_oauth_client_id" {
  name        = "/lolice/tailscale/operator-oauth-client-id"
  description = "Tailscale OAuth client ID for the Kubernetes Operator"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"

  tags = {
    Project = "lolice"
    Purpose = "tailscale-k8s-operator"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "operator_oauth_client_secret" {
  name        = "/lolice/tailscale/operator-oauth-client-secret"
  description = "Tailscale OAuth client secret for the Kubernetes Operator"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"

  tags = {
    Project = "lolice"
    Purpose = "tailscale-k8s-operator"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

# ── Workload Identity Federation credentials ────────────────────────
# These are NOT secrets (public identifiers), but stored in SSM for
# consistent management and to allow lolice ExternalSecret to pull them.

resource "aws_ssm_parameter" "operator_wif_client_id" {
  name        = "/lolice/tailscale/operator-wif-client-id"
  description = "Tailscale WIF client ID for the Kubernetes Operator (not a secret)"
  type        = "String"
  value       = tailscale_federated_identity.k8s_operator.id

  tags = {
    Project = "lolice"
    Purpose = "tailscale-k8s-operator-wif"
  }
}

resource "aws_ssm_parameter" "operator_wif_audience" {
  name        = "/lolice/tailscale/operator-wif-audience"
  description = "Tailscale WIF audience for the Kubernetes Operator (not a secret)"
  type        = "String"
  value       = tailscale_federated_identity.k8s_operator.audience

  tags = {
    Project = "lolice"
    Purpose = "tailscale-k8s-operator-wif"
  }
}
