moved {
  from = cloudflare_access_application.moltworker
  to   = cloudflare_zero_trust_access_application.moltworker
}

removed {
  from = cloudflare_access_policy.moltworker_policy
  lifecycle {
    destroy = false
  }
}
