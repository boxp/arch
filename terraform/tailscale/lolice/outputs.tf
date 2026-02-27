output "wif_client_id" {
  description = "The client ID of the WIF federated identity for GitHub Actions."
  value       = tailscale_federated_identity.github_actions_argocd_diff.id
}

output "subnet_router_auth_key_id" {
  description = "The ID of the auth key for the subnet router."
  value       = tailscale_tailnet_key.subnet_router.id
}
