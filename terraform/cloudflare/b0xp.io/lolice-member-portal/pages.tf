resource "cloudflare_dns_record" "lolice_member_portal" {
  zone_id = "ec593206d0ef695c3aae3a4cb3173264"
  name    = "lolice.b0xp.io"
  type    = "AAAA"
  content = "100::"
  ttl     = 1
  proxied = true
}
