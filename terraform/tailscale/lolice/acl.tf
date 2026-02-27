# Tailscale ACL policy for the lolice PoC.
# Defines tag ownership and access rules for CI/CD keyless access.
resource "tailscale_acl" "this" {
  acl = jsonencode({
    tagOwners = {
      "tag:ci"             = ["autogroup:admin"]
      "tag:subnet-router"  = ["autogroup:admin"]
    }

    acls = var.argocd_service_cluster_ip != "" ? [
      # Allow CI-tagged nodes to reach ArgoCD API via subnet router.
      # dst uses the actual ClusterIP; tag-based dst does not cover
      # subnet route targets.
      {
        action = "accept"
        src    = ["tag:ci"]
        dst    = ["${var.argocd_service_cluster_ip}/32:443"]
      },
    ] : []

    autoApprovers = var.argocd_service_cluster_ip != "" ? {
      routes = {
        "${var.argocd_service_cluster_ip}/32" = ["tag:subnet-router"]
      }
    } : {}
  })
}
