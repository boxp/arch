locals {
  even_g2_main_hostname = "even-g2-main.b0xp.io"
  # Pinned in boxp/lolice argoproj/even-g2-lab/service.yaml (spec.clusterIP).
  even_g2_main_cluster_ip = "10.104.181.159"
}

# BOXP-318: keep the human-facing URL as a hostname without publishing a DNS
# record. WARP clients (Traffic and DNS mode) send DNS to Gateway, which answers
# this single hostname with the pinned ClusterIP; the packets then follow the
# split tunnel Include /32 and the CIDR route on this tunnel.
# A Kubernetes Service FQDN (*.svc.cluster.local) cannot be used on the phone:
# `local` is in the default Local Domain Fallback list, and forwarding
# cluster.local to CoreDNS needs Gateway resolver policies (Enterprise only).
resource "cloudflare_zero_trust_gateway_policy" "even_g2_main_override" {
  account_id  = var.account_id
  name        = "even-g2-main private override"
  description = "BOXP-318: answer even-g2-main.b0xp.io with the lolice even-g2-main ClusterIP for WARP clients"
  action      = "override"
  enabled     = true
  filters     = ["dns"]
  traffic     = "dns.fqdn == \"${local.even_g2_main_hostname}\""
  rule_settings = {
    override_ips = [local.even_g2_main_cluster_ip]
  }
}
