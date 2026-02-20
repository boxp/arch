migration "state" "rm_r2_bucket" {
  dir = "."
  actions = [
    "rm cloudflare_r2_bucket.moltworker_data",
  ]
  skip_plan = true
}
