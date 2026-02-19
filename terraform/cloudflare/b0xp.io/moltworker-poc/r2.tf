# R2 bucket for Moltworker PoC persistent storage.
# Used for openclaw configuration, conversation history, and file persistence
# across container restarts.
resource "cloudflare_r2_bucket" "moltworker_poc_data" {
  account_id = var.account_id
  name       = "moltworker-poc-data"
  location   = "APAC"
}
