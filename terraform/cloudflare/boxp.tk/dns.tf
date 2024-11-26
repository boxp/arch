resource "cloudflare_record" "root" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "@"
  type    = "A"
  content = "192.0.2.1" # 全て転送するので、ダミーのIPアドレスにしておく
  proxied = true
}

resource "cloudflare_record" "www" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "www"
  type    = "CNAME"
  content = "boxp.tk"
  proxied = true
}

resource "cloudflare_record" "hitohub" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "hitohub"
  type    = "CNAME"
  content = "boxp.tk"
  proxied = true
}
