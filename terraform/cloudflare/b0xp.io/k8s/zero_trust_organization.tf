# Zero Trust organization (Access settings) for the whole account.
#
# The organization was created and managed in the dashboard. It is imported
# here only to turn on "Authenticate with Cloudflare One Client" (client
# sessions, formerly WARP authentication identity) via
# warp_auth_session_duration (BOXP-324).
#
# The provider updates this resource with a full PUT, so every attribute that
# is omitted from the configuration would be reset. To keep all existing
# dashboard-managed values (auth domain, login design, MFA, etc.), every
# attribute is passed through from the current organization read by the data
# source, and only warp_auth_session_duration is set explicitly.
#
# allow_authenticate_via_warp ("Apply to all Access applications") is kept at
# its current value on purpose: client sessions are enabled per Access
# application instead of for every application by default.

data "cloudflare_zero_trust_organization" "current" {
  account_id = var.account_id
}

import {
  to = cloudflare_zero_trust_organization.this
  id = var.account_id
}

resource "cloudflare_zero_trust_organization" "this" {
  account_id = var.account_id

  # Authenticate with Cloudflare One Client: session timeout for Access
  # applications that enable client authentication (maximum 90 days).
  warp_auth_session_duration = "168h"

  # Pass-through of the current dashboard-managed values.
  allow_authenticate_via_warp                 = data.cloudflare_zero_trust_organization.current.allow_authenticate_via_warp
  auth_domain                                 = data.cloudflare_zero_trust_organization.current.auth_domain
  auto_redirect_to_identity                   = data.cloudflare_zero_trust_organization.current.auto_redirect_to_identity
  custom_pages                                = data.cloudflare_zero_trust_organization.current.custom_pages
  deny_unmatched_requests                     = data.cloudflare_zero_trust_organization.current.deny_unmatched_requests
  deny_unmatched_requests_exempted_zone_names = data.cloudflare_zero_trust_organization.current.deny_unmatched_requests_exempted_zone_names
  is_ui_read_only                             = data.cloudflare_zero_trust_organization.current.is_ui_read_only
  # Keep login_design null instead of an empty object when it is not configured.
  login_design              = alltrue([for v in values(try(tomap(data.cloudflare_zero_trust_organization.current.login_design), {})) : v == null]) ? null : data.cloudflare_zero_trust_organization.current.login_design
  mfa_config                = data.cloudflare_zero_trust_organization.current.mfa_config
  mfa_piv_key_requirements  = data.cloudflare_zero_trust_organization.current.mfa_piv_key_requirements
  mfa_required_for_all_apps = data.cloudflare_zero_trust_organization.current.mfa_required_for_all_apps
  name                      = data.cloudflare_zero_trust_organization.current.name
  session_duration                   = data.cloudflare_zero_trust_organization.current.session_duration
  strict_service_token_auth          = data.cloudflare_zero_trust_organization.current.strict_service_token_auth
  ui_read_only_toggle_reason         = data.cloudflare_zero_trust_organization.current.ui_read_only_toggle_reason
  user_seat_expiration_inactive_time = data.cloudflare_zero_trust_organization.current.user_seat_expiration_inactive_time
  warp_auth_non_browser_401          = data.cloudflare_zero_trust_organization.current.warp_auth_non_browser_401

  lifecycle {
    # service_token_inactivity has never been configured, so the API returns
    # only { enabled = false }. The resource requires action and
    # inactivity_threshold_days as well, so that value cannot be written in
    # the configuration, and leaving it null would show a removal on every
    # plan. Keep the value from the state and leave this setting to the
    # dashboard.
    ignore_changes = [service_token_inactivity]
  }
}
