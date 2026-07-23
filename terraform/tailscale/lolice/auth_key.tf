# Auth key for the subnet router Pod deployed in the lolice cluster.
# This is separate from WIF; subnet router is a long-running Pod
# that needs a pre-authorized, reusable auth key.
resource "tailscale_tailnet_key" "subnet_router" {
  reusable      = true
  ephemeral     = true
  preauthorized = true
  tags          = ["tag:subnet-router"]
  description   = "lolice subnet router for ArgoCD API access"

  # ACL must be applied first so that tag:subnet-router is recognised.
  depends_on = [tailscale_acl.this]
}

# Store the auth key in AWS SSM Parameter Store for External Secrets to consume.
resource "aws_ssm_parameter" "subnet_router_auth_key" {
  name        = "/lolice/tailscale/subnet-router-auth-key"
  description = "Tailscale auth key for lolice subnet router Pod"
  type        = "SecureString"
  value       = tailscale_tailnet_key.subnet_router.key
}

# Auth key for Oracle Cloud control plane nodes.
# These are long-running VMs that need a reusable, preauthorized key
# so cloud-init can register them into the tailnet automatically.
resource "tailscale_tailnet_key" "cloud_control_plane" {
  reusable      = true
  ephemeral     = false
  preauthorized = true
  tags          = ["tag:cloud-control-plane"]
  description   = "lolice OCI cloud control plane nodes"

  depends_on = [tailscale_acl.this]
}

# Store the auth key in AWS SSM Parameter Store.
# The terraform/oci/lolice-control-plane module reads this to pass into cloud-init.
resource "aws_ssm_parameter" "cloud_control_plane_auth_key" {
  name        = "/lolice/tailscale/cloud-control-plane-auth-key"
  description = "Tailscale auth key for lolice Oracle Cloud control plane nodes"
  type        = "SecureString"
  value       = tailscale_tailnet_key.cloud_control_plane.key
}
