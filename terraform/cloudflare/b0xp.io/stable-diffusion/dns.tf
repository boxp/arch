resource "cloudflare_dns_record" "stable_diffusion" {
  zone_id = var.zone_id
  name    = "sd-webui.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.stable_diffusion.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# BOXP-498: ComfyUI も既存の stable-diffusion トンネルを通す。
resource "cloudflare_dns_record" "comfyui" {
  zone_id = var.zone_id
  name    = "comfyui.b0xp.io"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.stable_diffusion.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}
