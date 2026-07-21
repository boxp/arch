# Creates the CNAME record that routes bastion.b0xp.io to the tunnel.
resource "cloudflare_dns_record" "bastion" {
  zone_id = var.zone_id
  name    = "bastion"
  content = "\${cloudflare_zero_trust_tunnel_cloudflared.bastion.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
