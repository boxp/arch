resource "cloudflare_record" "lolice_member_portal" {
  zone_id = "ec593206d0ef695c3aae3a4cb3173264"
  name    = "lolice"
  type    = "AAAA"
  content = "100::"
  proxied = true
}
