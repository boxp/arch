# BOXP-428: lets a person who passed Cloudflare Access enter Langfuse without a second password.
# The application reuses the Owner-only policy of access.tf, so this issuer never signs a token for
# anyone else. boxp/lolice argoproj/langfuse reads these parameters.
data "cloudflare_zero_trust_organization" "current" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  github_idp_id = one([
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ])
  owner_policy = one([
    for p in data.cloudflare_zero_trust_access_policies.all.result :
    p if p.name == local.owner_policy_name
  ])
  # The account that holds OWNER in Langfuse follows the policy instead of being written twice.
  owner_emails = [for rule in local.owner_policy.include : rule.email.email if rule.email != null]
  langfuse_oidc_issuer = "https://${data.cloudflare_zero_trust_organization.current.auth_domain}/cdn-cgi/access/sso/oidc/${cloudflare_zero_trust_access_application.langfuse_oidc.saas_app.client_id}"
}

resource "cloudflare_zero_trust_access_application" "langfuse_oidc" {
  account_id                = var.account_id
  name                      = "Access for SaaS application for Langfuse login"
  type                      = "saas"
  app_launcher_visible      = false
  allowed_idps              = [local.github_idp_id]
  auto_redirect_to_identity = true
  policies                  = [{ id = local.owner_policy_id }]
  saas_app = {
    auth_type                        = "oidc"
    redirect_uris                    = ["https://langfuse.b0xp.io/api/auth/callback/custom"]
    grant_types                      = ["authorization_code_with_pkce"]
    scopes                           = ["openid", "email", "profile"]
    allow_pkce_without_client_secret = false
  }

  lifecycle {
    precondition {
      condition     = length(local.owner_emails) == 1
      error_message = "The Owner policy must name exactly one email: Langfuse gives it OWNER."
    }
  }
}

resource "aws_ssm_parameter" "langfuse_oidc_issuer" {
  name        = "langfuse-oidc-issuer"
  description = "for langfuse login through Cloudflare Access"
  type        = "SecureString"
  value       = local.langfuse_oidc_issuer
}

resource "aws_ssm_parameter" "langfuse_oidc_client_id" {
  name        = "langfuse-oidc-client-id"
  description = "for langfuse login through Cloudflare Access"
  type        = "SecureString"
  value       = cloudflare_zero_trust_access_application.langfuse_oidc.saas_app.client_id
}

resource "aws_ssm_parameter" "langfuse_oidc_client_secret" {
  name        = "langfuse-oidc-client-secret"
  description = "for langfuse login through Cloudflare Access"
  type        = "SecureString"
  value       = cloudflare_zero_trust_access_application.langfuse_oidc.saas_app.client_secret

  lifecycle {
    # Cloudflare returns the secret only when the application is created.
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "langfuse_owner_email" {
  name        = "langfuse-owner-email"
  description = "Langfuse account that holds OWNER; same as the Access policy"
  type        = "SecureString"
  value       = local.owner_emails[0]
}
