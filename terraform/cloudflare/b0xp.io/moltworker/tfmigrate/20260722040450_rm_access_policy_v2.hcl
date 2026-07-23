migration "state" "rm_access_policy_v2" {
  # force=true handles both "resource exists" (removes it) and
  # "resource not found" (no-op) so this migration is idempotent.
  # Needed because rm_access_policy may be in S3 history but state may still
  # have cloudflare_access_policy (v4 type with no v5 schema) causing terraform
  # plan to fail with "no schema available" even with job_type:terraform.
  force = true
  actions = [
    "rm cloudflare_access_policy.moltworker_policy",
  ]
}
