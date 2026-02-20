migration "state" "remove_old_bucket" {
  actions = [
    "rm cloudflare_r2_bucket.moltworker_data",
  ]
}
