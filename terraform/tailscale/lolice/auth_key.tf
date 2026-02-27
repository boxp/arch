# Auth key for the subnet router Pod deployed in the lolice cluster.
# This is separate from WIF; subnet router is a long-running Pod
# that needs a pre-authorized, reusable auth key.
#
# NOTE: Uncomment when TAILSCALE_API_KEY and TAILSCALE_TAILNET are configured.
# resource "tailscale_tailnet_key" "subnet_router" {
#   reusable      = true
#   ephemeral     = true
#   preauthorized = true
#   tags          = ["tag:subnet-router"]
#   description   = "lolice subnet router for ArgoCD API access"
# }

# Store the auth key in AWS SSM Parameter Store for External Secrets to consume.
# resource "aws_ssm_parameter" "subnet_router_auth_key" {
#   name        = "/lolice/tailscale/subnet-router-auth-key"
#   description = "Tailscale auth key for lolice subnet router Pod"
#   type        = "SecureString"
#   value       = tailscale_tailnet_key.subnet_router.key
# }
