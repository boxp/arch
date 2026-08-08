# Tailscale ACL policy for the lolice PoC.
# Defines tag ownership and access rules for CI/CD keyless access.
resource "tailscale_acl" "this" {
  acl = jsonencode({
    tagOwners = {
      "tag:ci"                  = ["autogroup:admin"]
      "tag:subnet-router"       = ["autogroup:admin"]
      "tag:k8s-operator"        = ["autogroup:admin"]
      "tag:cloud-control-plane" = ["autogroup:admin"]
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
        # Allow cloud control plane nodes to communicate with on-prem cluster.
        # etcd peer (2380), etcd client (2379), kubelet (10250), apiserver (6443)
        {
          action = "accept"
          src    = ["tag:cloud-control-plane"]
          dst    = ["*:2379", "*:2380", "*:6443", "*:10250"]
        },
        # Allow on-prem nodes to reach cloud control plane (reverse direction).
        # Restricted to authenticated tailnet members and known service tags
        # to avoid granting etcd/kubelet access to every tagged device.
        {
          action = "accept"
          src    = ["autogroup:members", "tag:subnet-router", "tag:k8s-operator"]
          dst    = ["tag:cloud-control-plane:2379", "tag:cloud-control-plane:2380", "tag:cloud-control-plane:6443", "tag:cloud-control-plane:10250"]
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

    autoApprovers = {
      routes = merge(
        # Allow tag:subnet-router nodes to advertise the lolice LAN subnet.
        # Cloud CPs use --accept-routes so they can reach the VIP 192.168.10.99.
        { "192.168.10.0/24" = ["tag:subnet-router"] },
        var.argocd_service_cluster_ip != "" ? {
          "${var.argocd_service_cluster_ip}/32" = ["tag:subnet-router"]
        } : {}
      )
    }
  })
}
