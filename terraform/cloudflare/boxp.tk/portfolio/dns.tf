resource "cloudflare_ruleset" "boxp_tk_portfolio_redirects" {
  zone_id = var.zone_id
  name    = "boxp.tk portfolio redirects"
  kind    = "zone"
  phase   = "http_request_redirect"

  rules {
    action = "redirect"
    action_parameters {
      from_value {
        status_code = 301
        target_url {
          expression = "concat(\"https://www.b0xp.io\", http.request.uri.path)"
        }
        preserve_query_string = true
      }
    }
    expression  = "(http.host eq \"boxp.tk\")"
    description = "Redirect boxp.tk to www.b0xp.io"
    enabled     = true
  }

  rules {
    action = "redirect"
    action_parameters {
      from_value {
        status_code = 301
        target_url {
          expression = "concat(\"https://www.b0xp.io\", http.request.uri.path)"
        }
        preserve_query_string = true
      }
    }
    expression  = "(http.host eq \"www.boxp.tk\")"
    description = "Redirect www.boxp.tk to www.b0xp.io"
    enabled     = true
  }
}
