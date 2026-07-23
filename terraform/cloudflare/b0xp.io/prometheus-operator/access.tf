# Creates an Access application to control who can connect.
removed {
  from = cloudflare_access_policy.grafana_policy
  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_access_policy.prometheus_web_policy
  lifecycle {
    destroy = false
  }
}

resource "cloudflare_zero_trust_access_application" "grafana" {
  zone_id          = var.zone_id
  name             = "Access application for grafana.b0xp.io"
  domain           = "grafana.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.grafana_policy.id }]
}

# Creates an Access application to control who can connect.
resource "cloudflare_zero_trust_access_application" "prometheus_web" {
  zone_id          = var.zone_id
  name             = "Access application for prometheus-web.b0xp.io"
  domain           = "prometheus-web.b0xp.io"
  session_duration = "24h"
  type             = "self_hosted"
  policies         = [{ id = cloudflare_zero_trust_access_policy.prometheus_web_policy.id }]
}

data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.account_id
}

locals {
  github_idp_id = [
    for p in data.cloudflare_zero_trust_access_identity_providers.all.result :
    p.id if p.type == "github"
  ][0]
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "grafana_policy" {
  account_id = var.account_id
  name       = "policy for grafana.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}

# Creates an Access policy for the application.
resource "cloudflare_zero_trust_access_policy" "prometheus_web_policy" {
  account_id = var.account_id
  name       = "policy for prometheus-web.b0xp.io"
  decision   = "allow"
  include = [{
    login_method = {
      id = local.github_idp_id
    }
  }]
}
