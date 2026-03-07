# Tailscale ACL policy for the lolice PoC.
# Defines tag ownership and access rules for CI/CD keyless access.
resource "tailscale_acl" "this" {
  acl = jsonencode({
    tagOwners = {
      "tag:ci"            = ["autogroup:admin"]
      "tag:subnet-router" = ["autogroup:admin"]
      "tag:k8s-operator"  = ["autogroup:admin"]
      "tag:k8s"           = ["tag:k8s-operator"]
    }

    acls = concat(
      [
        # Allow CI-tagged nodes to reach K8s Operator proxy pods
        # (e.g. lolice-argocd exposed via tailscale.com/expose annotation).
        # Port 80: ArgoCD grpc-web plaintext (used by argocd-diff workflow)
        # Port 443: ArgoCD HTTPS
        {
          action = "accept"
          src    = ["tag:ci"]
          dst    = ["tag:k8s-operator:80", "tag:k8s-operator:443"]
        },
      ],
      var.argocd_service_cluster_ip != "" ? [
        # Allow CI-tagged nodes to reach ArgoCD API via subnet router.
        # dst uses the actual ClusterIP; tag-based dst does not cover
        # subnet route targets.
        {
          action = "accept"
          src    = ["tag:ci"]
          dst    = ["${var.argocd_service_cluster_ip}/32:443"]
        },
      ] : []
    )

    autoApprovers = var.argocd_service_cluster_ip != "" ? {
      routes = {
        "${var.argocd_service_cluster_ip}/32" = ["tag:subnet-router"]
      }
    } : {}
  })
}
