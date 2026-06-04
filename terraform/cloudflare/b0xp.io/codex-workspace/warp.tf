resource "cloudflare_zero_trust_access_service_token" "codex_workspace_warp" {
  account_id = var.account_id
  name       = "Codex workspace WARP enrollment"
  duration   = "8760h"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "codex_workspace_warp_enrollment" {
  account_id = var.account_id
  name       = "Allow Codex workspace WARP enrollment service token"
  decision   = "non_identity"

  include = [
    {
      service_token = {
        token_id = cloudflare_zero_trust_access_service_token.codex_workspace_warp.id
      }
    }
  ]
}

data "cloudflare_zero_trust_access_applications" "account" {
  account_id = var.account_id
  max_items  = 1000
}

locals {
  cloudflare_one_client_application = one([
    for application in data.cloudflare_zero_trust_access_applications.account.result : application
    if application.type == "warp"
  ])

  existing_cloudflare_one_client_policies = [
    for policy in local.cloudflare_one_client_application.policies : {
      id         = policy.id
      precedence = policy.precedence
    }
    if policy.id != cloudflare_zero_trust_access_policy.codex_workspace_warp_enrollment.id
  ]

  cloudflare_one_client_next_policy_precedence = max(
    concat([0], [for policy in local.existing_cloudflare_one_client_policies : policy.precedence])...
  ) + 1
}

import {
  to = cloudflare_zero_trust_access_application.cloudflare_one_client
  id = "accounts/${var.account_id}/${local.cloudflare_one_client_application.id}"
}

resource "cloudflare_zero_trust_access_application" "cloudflare_one_client" {
  account_id = var.account_id
  name       = local.cloudflare_one_client_application.name
  type       = "warp"

  policies = concat(
    local.existing_cloudflare_one_client_policies,
    [
      {
        id         = cloudflare_zero_trust_access_policy.codex_workspace_warp_enrollment.id
        precedence = local.cloudflare_one_client_next_policy_precedence
      }
    ]
  )
}

resource "aws_ssm_parameter" "cloudflare_warp_auth_client_id" {
  name        = "/lolice/codex-workspace/cloudflare-warp-auth-client-id"
  description = "Cloudflare WARP service token client ID for non-interactive Codex workspace enrollment"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_access_service_token.codex_workspace_warp.client_id)

  tags = {
    Project = "lolice"
    Purpose = "codex-workspace"
  }
}

resource "aws_ssm_parameter" "cloudflare_warp_auth_client_secret" {
  name        = "/lolice/codex-workspace/cloudflare-warp-auth-client-secret"
  description = "Cloudflare WARP service token client secret for non-interactive Codex workspace enrollment"
  type        = "SecureString"
  value       = sensitive(cloudflare_zero_trust_access_service_token.codex_workspace_warp.client_secret)

  tags = {
    Project = "lolice"
    Purpose = "codex-workspace"
  }
}

resource "aws_ssm_parameter" "cloudflare_warp_organization" {
  name        = "/lolice/codex-workspace/cloudflare-warp-organization"
  description = "Cloudflare Zero Trust team name for Codex workspace WARP enrollment"
  type        = "SecureString"
  value       = var.cloudflare_zero_trust_team_name

  tags = {
    Project = "lolice"
    Purpose = "codex-workspace"
  }
}
