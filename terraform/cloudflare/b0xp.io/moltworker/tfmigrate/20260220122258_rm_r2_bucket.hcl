migration "state" "rm_r2_bucket" {
  # force=true added for v4->v5 migration: terraform plan will show expected
  # diffs after state rm (provider version change causes attribute diffs).
  force = true
  actions = [
    "rm cloudflare_r2_bucket.moltworker_data",
  ]
}
