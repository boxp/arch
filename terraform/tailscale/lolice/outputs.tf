output "wif_client_id" {
  description = "The client ID of the WIF federated identity for GitHub Actions."
  value       = tailscale_federated_identity.github_actions_argocd_diff.id
}

output "arch_plan_wif_client_id" {
  description = "Non-secret client ID for TAILSCALE_WIF_PLAN_CLIENT_ID."
  value       = tailscale_federated_identity.github_actions_arch_plan.id
}

output "arch_plan_wif_audience" {
  description = "Non-secret generated audience for TAILSCALE_WIF_PLAN_AUDIENCE."
  value       = tailscale_federated_identity.github_actions_arch_plan.audience
}

output "subnet_router_auth_key_id" {
  description = "The ID of the auth key for the subnet router."
  value       = tailscale_tailnet_key.subnet_router.id
}

output "arch_ci_plan_wif_client_id" {
  description = "Non-secret client ID for TAILSCALE_WIF_CI_PLAN_CLIENT_ID."
  value       = tailscale_federated_identity.github_actions_arch_ci_plan.id
}

output "arch_apply_wif_client_id" {
  description = "Non-secret client ID for TAILSCALE_WIF_APPLY_CLIENT_ID."
  value       = tailscale_federated_identity.github_actions_arch_apply.id
}

output "subnet_router_auth_key_expires_at" {
  description = "Expiry metadata of the subnet router auth key (not the key itself)."
  value       = tailscale_tailnet_key.subnet_router.expires_at
}
