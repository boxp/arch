migration "state" "rm_r2_bucket" {
  actions = [
    "rm cloudflare_r2_bucket.moltworker_data",
  ]
}
