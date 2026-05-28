# Stabilize Tailscale Terraform Plan

## Context

Renovate pull requests that touch `terraform/tailscale/lolice` are failing in
tfaction plan even though the dependency update is unrelated to live Tailscale
configuration.

The observed plan difference is limited to:

- `aws_ssm_parameter.subnet_router_auth_key`
- `/lolice/tailscale/subnet-router-auth-key`

Terraform plans an in-place SSM parameter update for the auth key value.  This
is a generated secret consumed outside Terraform, so dependency update PRs
should not be blocked by value drift in that parameter.

## Plan

1. Keep the Tailscale Terraform target and GitHub Actions secrets in place.
2. Match the subnet router auth key SSM parameter to the existing operator OAuth
   SSM parameters by ignoring value-only drift.
3. Re-run the failing Renovate PRs after this fix lands:
   - `boxp/arch#9591`
   - `boxp/arch#9519`
   - `boxp/arch#9619`

## Validation

- `terraform fmt -check terraform/tailscale/lolice`
- `git diff --check`
