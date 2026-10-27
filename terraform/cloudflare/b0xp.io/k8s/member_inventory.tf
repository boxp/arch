# BOXP-330 (temporary, read-only): inventory of the live Zero Trust settings
# that decide what lolice members can reach over WARP. Everything here is a
# data source or an output; nothing is created or changed. Member e-mail
# addresses are redacted before they reach the plan output (the repository is
# public). This file is removed again before the isolation change is merged.

locals {
  inventory_owner_emails = ["tiyotiyouda@gmail.com"]
  inventory_email_regex  = "/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/"
}

data "cloudflare_zero_trust_gateway_policies" "inventory" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_device_custom_profiles" "inventory" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_tunnel_cloudflared_routes" "inventory" {
  account_id = var.account_id
  is_deleted = false
}

data "cloudflare_zero_trust_tunnel_cloudflared_virtual_networks" "inventory" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_device_settings" "inventory" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_lists" "inventory" {
  account_id = var.account_id
}

data "cloudflare_zero_trust_access_applications" "inventory" {
  account_id = var.account_id
  max_items  = 1000
}

locals {
  inventory_gateway = [
    for p in data.cloudflare_zero_trust_gateway_policies.inventory.result : {
      name       = p.name
      precedence = p.precedence
      enabled    = p.enabled
      action     = p.action
      filters    = p.filters
      traffic    = replace(replace(coalesce(p.traffic, ""), local.inventory_owner_emails[0], "OWNER"), local.inventory_email_regex, "<email>")
      identity   = replace(replace(coalesce(p.identity, ""), local.inventory_owner_emails[0], "OWNER"), local.inventory_email_regex, "<email>")
      posture    = coalesce(p.device_posture, "")
    }
  ]
}

output "inventory_gateway_rules" {
  description = "BOXP-330 temporary read-only inventory (inventory_gateway_rules)"
  value       = local.inventory_gateway
}

output "inventory_device_settings" {
  description = "BOXP-330 temporary read-only inventory (inventory_device_settings)"
  value = {
    gateway_proxy_enabled     = data.cloudflare_zero_trust_device_settings.inventory.gateway_proxy_enabled
    gateway_udp_proxy_enabled = data.cloudflare_zero_trust_device_settings.inventory.gateway_udp_proxy_enabled
    use_zt_virtual_ip         = data.cloudflare_zero_trust_device_settings.inventory.use_zt_virtual_ip
  }
}

output "inventory_custom_profiles" {
  description = "BOXP-330 temporary read-only inventory (inventory_custom_profiles)"
  value = [
    for p in data.cloudflare_zero_trust_device_custom_profiles.inventory.result : {
      name          = p.name
      precedence    = p.precedence
      enabled       = p.enabled
      default       = p.default
      match         = replace(replace(coalesce(p.match, ""), local.inventory_owner_emails[0], "OWNER"), local.inventory_email_regex, "<email>")
      include       = [for r in coalesce(p.include, []) : coalesce(r.address, r.host, "")]
      exclude_count = length(coalesce(p.exclude, []))
      tunnel        = p.tunnel_protocol
    }
  ]
}

output "inventory_tunnel_routes" {
  description = "BOXP-330 temporary read-only inventory (inventory_tunnel_routes)"
  value = [
    for r in data.cloudflare_zero_trust_tunnel_cloudflared_routes.inventory.result : {
      network = r.network
      comment = r.comment
      tunnel  = r.tunnel_name
      vnet    = r.virtual_network_name
    }
  ]
}

output "inventory_virtual_networks" {
  description = "BOXP-330 temporary read-only inventory (inventory_virtual_networks)"
  value = [
    for v in data.cloudflare_zero_trust_tunnel_cloudflared_virtual_networks.inventory.result : {
      name       = v.name
      is_default = v.is_default_network
    }
  ]
}

output "inventory_lists" {
  description = "BOXP-330 temporary read-only inventory (inventory_lists)"
  value = [
    for l in data.cloudflare_zero_trust_lists.inventory.result : {
      id    = l.id
      name  = l.name
      type  = l.type
      count = l.list_count
    }
  ]
}

output "inventory_warp_enrollment_policies" {
  description = "BOXP-330 temporary read-only inventory (inventory_warp_enrollment_policies)"
  value = [
    for app in data.cloudflare_zero_trust_access_applications.inventory.result : [
      for p in coalesce(app.policies, []) : {
        id          = p.id
        name        = p.name
        decision    = p.decision
        precedence  = p.precedence
        owner_in    = contains([for r in coalesce(p.include, []) : try(lower(r.email.email), "")], local.inventory_owner_emails[0])
        email_count = length([for r in coalesce(p.include, []) : r if try(r.email.email, null) != null])
        other_rules = flatten([for r in coalesce(p.include, []) : [for k, v in r : k if v != null && k != "email"]])
        exclude     = length(coalesce(p.exclude, []))
        require     = flatten([for r in coalesce(p.require, []) : [for k, v in r : k if v != null]])
      }
    ] if app.type == "warp"
  ]
}
