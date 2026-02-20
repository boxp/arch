# R2 bucket for Moltworker persistent storage.
# Used for openclaw configuration, conversation history, and file persistence
# across container restarts.

# Import the recreated bucket from Cloudflare
import {
  to = cloudflare_r2_bucket.moltworker_data
  id = "${var.account_id}/moltbot-data"
}

resource "cloudflare_r2_bucket" "moltworker_data" {
  account_id = var.account_id
  name       = "moltbot-data"
  location   = "APAC"
}
