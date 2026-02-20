migration "state" "rm_r2_bucket" {
  actions = [
    "rm cloudflare_r2_bucket.moltworker_data",
    "import cloudflare_r2_bucket.moltworker_data 1984a4314b3e75f3bedce97c7a8e0c81/moltbot-data",
  ]
}
