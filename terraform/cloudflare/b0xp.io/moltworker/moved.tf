moved {
  from = cloudflare_access_application.moltworker
  to   = cloudflare_zero_trust_access_application.moltworker
}

moved {
  from = cloudflare_access_policy.moltworker_policy
  to   = cloudflare_zero_trust_access_policy.moltworker_policy
}
