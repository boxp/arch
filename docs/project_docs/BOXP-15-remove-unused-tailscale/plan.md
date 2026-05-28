# BOXP-15: Remove unused Tailscale configuration

## Goal

Remove the unused Tailscale Terraform target for `lolice` so dependency update PRs no longer run `terraform/tailscale/lolice` plans that require stale Tailscale credentials or drifted SSM parameters.

## Scope

- Delete `terraform/tailscale/lolice`.
- Delete `templates/tailscale`.
- Remove the `terraform/tailscale/**` target group from `tfaction-root.yaml`.
- Remove `registry.terraform.io/tailscale/tailscale` from active provider allowlists.
- Remove `TAILSCALE_API_KEY` and `TAILSCALE_TAILNET` workflow secret plumbing that only existed for the Tailscale target.
- Keep historical project docs unchanged.

## Follow-up Outside Code

- Remove or retire GitHub repository secrets `TAILSCALE_API_KEY` and `TAILSCALE_TAILNET` if no other repository uses them.
- Confirm whether remote Terraform state `terraform/tailscale/lolice/v1/terraform.tfstate` should be archived or deleted after the cleanup is applied.
- Close or supersede stale Tailscale-related PRs after replacement cleanup PRs are open.

## Verification

- Search for remaining active Tailscale references outside historical docs.
- Run YAML parsing against changed workflow/config files.
- Run repository formatting or validation commands where available.
