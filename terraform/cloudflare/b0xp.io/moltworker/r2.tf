# R2 bucket for Moltworker persistent storage.
# Used for openclaw configuration, conversation history, and file persistence
# across container restarts.

removed {
  from = cloudflare_r2_bucket.moltworker_data

  lifecycle {
    destroy = false
  }
}
