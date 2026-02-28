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
