resource "cloudflare_dns_record" "stable_diffusion" {
  zone_id = var.zone_id
  name    = "sd-webui"
  content = cloudflare_zero_trust_tunnel_cloudflared.stable_diffusion.cname
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
