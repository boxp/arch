# R2 bucket for Moltworker persistent storage.
# Used for openclaw configuration, conversation history, and file persistence
# across container restarts.

import {
  id = "1984a4314b3e75f3bedce97c7a8e0c81/moltbot-data"
  to = cloudflare_r2_bucket.moltworker_data
}

resource "cloudflare_r2_bucket" "moltworker_data" {
  account_id = var.account_id
  name       = "moltbot-data"
  location   = "ENAM"
}
