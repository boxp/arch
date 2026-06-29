resource "cloudflare_record" "stable_diffusion" {
  zone_id = var.zone_id
  name    = "sd-webui"
  value   = cloudflare_tunnel.stable_diffusion.cname
  type    = "CNAME"
  proxied = true
}

