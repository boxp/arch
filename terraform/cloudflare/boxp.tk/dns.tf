resource "cloudflare_dns_record" "root" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "@"
  type    = "A"
  content = "192.0.2.1" # 全て転送するので、ダミーのIPアドレスにしておく
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "www" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "www"
  type    = "CNAME"
  content = "boxp.tk"
  ttl     = 1
  proxied = true
}

resource "cloudflare_dns_record" "hitohub" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "hitohub"
  type    = "CNAME"
  content = "boxp.tk"
  ttl     = 1
  proxied = true
}

# zone-level の http_request_redirect phase entry-point ruleset は1つのみ許可されるため、
# boxp.tk zone の全リダイレクトルールをここに集約する。
resource "cloudflare_ruleset" "boxp_tk_redirects" {
  zone_id = cloudflare_zone.boxp_tk.id
  name    = "boxp.tk redirects"
  kind    = "zone"
  phase   = "http_request_redirect"

  rules = [
    {
      action = "redirect"
      action_parameters = {
        from_value = {
          status_code = 301
          target_url = {
            expression = "concat(\"https://hitohub.b0xp.io\", http.request.uri.path)"
          }
          preserve_query_string = true
        }
      }
      expression  = "(http.host eq \"hitohub.boxp.tk\")"
      description = "Redirect hitohub.boxp.tk to hitohub.b0xp.io"
      enabled     = true
    },
    {
      action = "redirect"
      action_parameters = {
        from_value = {
          status_code = 301
          target_url = {
            expression = "concat(\"https://www.b0xp.io\", http.request.uri.path)"
          }
          preserve_query_string = true
        }
      }
      expression  = "(http.host eq \"boxp.tk\")"
      description = "Redirect boxp.tk to www.b0xp.io"
      enabled     = true
    },
    {
      action = "redirect"
      action_parameters = {
        from_value = {
          status_code = 301
          target_url = {
            expression = "concat(\"https://www.b0xp.io\", http.request.uri.path)"
          }
          preserve_query_string = true
        }
      }
      expression  = "(http.host eq \"www.boxp.tk\")"
      description = "Redirect www.boxp.tk to www.b0xp.io"
      enabled     = true
    }
  ]
}
