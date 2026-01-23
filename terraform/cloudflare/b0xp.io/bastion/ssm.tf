# Store Cloudflare Access credentials in AWS SSM Parameter Store
resource "aws_ssm_parameter" "cf_access_client_id" {
  name        = "bastion-cf-access-client-id"
  description = "Cloudflare Access Client ID for bastion"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_actions.client_id)
}

resource "aws_ssm_parameter" "cf_access_client_secret" {
  name        = "bastion-cf-access-client-secret"
  description = "Cloudflare Access Client Secret for bastion"
  type        = "SecureString"
  value       = sensitive(cloudflare_access_service_token.github_actions.client_secret)
}
