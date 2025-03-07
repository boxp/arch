resource "cloudflare_page_rule" "redirect_hitohub_prod" {
  zone_id  = var.zone_id                # ドメインのzone ID
  target   = "https://hitohub.boxp.tk/*" # リダイレクト元
  priority = 3                          # ルールの優先度

  actions {
    forwarding_url {
      url         = "https://hitohub.b0xp.io$1" # リダイレクト先URL
      status_code = 301                         # 301リダイレクト
    }
  }
}
