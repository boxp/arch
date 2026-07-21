resource "cloudflare_ruleset" "boxp_tk_hitohub_prod_redirects" {
  zone_id = var.zone_id
  name    = "boxp.tk hitohub prod redirects"
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
    }
  ]
}
