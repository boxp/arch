output "wif_client_id" {
  description = "The client ID of the WIF federated identity for GitHub Actions."
  value       = tailscale_federated_identity.github_actions_argocd_diff.id
}

output "subnet_router_auth_key_id" {
  description = "The ID of the auth key for the subnet router."
  value       = tailscale_tailnet_key.subnet_router.id
}

output "k8s_operator_wif_client_id" {
  description = "The client ID of the WIF federated identity for the K8s Operator."
  value       = tailscale_federated_identity.k8s_operator.id
}

output "k8s_operator_wif_audience" {
  description = "The audience value for the K8s Operator WIF credential."
  value       = tailscale_federated_identity.k8s_operator.audience
}

output "k8s_oidc_issuer_url" {
  description = "The public OIDC issuer URL (S3-hosted) for the lolice cluster."
  value       = local.oidc_issuer_url
}
