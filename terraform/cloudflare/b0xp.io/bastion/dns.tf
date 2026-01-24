# Creates the CNAME record that routes bastion.b0xp.io to the tunnel.
resource "cloudflare_record" "bastion" {
  zone_id = var.zone_id
  name    = "bastion"
  content = cloudflare_tunnel.bastion.cname
  type    = "CNAME"
  proxied = true
}
