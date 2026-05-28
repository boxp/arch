# Tailscale Auth Key Rotation Follow-up

## Context

After rotating the `TAILSCALE_API_KEY` GitHub secret, the Tailscale Terraform
plan can refresh state again.  The remaining plan change for Renovate PR
`boxp/arch#9591` is an expired subnet router auth key:

- `tailscale_tailnet_key.subnet_router` is `invalid = true`
- `expires_at = "2026-05-28T09:01:33Z"`
- `aws_ssm_parameter.subnet_router_auth_key` must be updated with the new key

The Renovate PR must keep a no-change plan for automerge, so this drift should
be handled in a dedicated follow-up PR.

## Plan

1. Record `boxp/arch#9591` in `terraform/tailscale/lolice/.tfaction/failed-prs`.
2. Let tfaction plan this follow-up PR and confirm it only rotates the expired
   subnet router auth key.
3. Merge this follow-up PR first so the Terraform apply creates a fresh
   Tailscale auth key and updates the SSM parameter.
4. Re-run or rebase `boxp/arch#9591` after the apply completes.

## Validation

- `git diff --check`
