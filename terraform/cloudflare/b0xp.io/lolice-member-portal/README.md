# lolice member portal Worker

Terraform deploys the Worker script and its non-sensitive bindings.
Worker secrets (`CF_API_TOKEN` and `RESEND_API_KEY`) are **not** stored in
Terraform state. Instead, a `null_resource` provisioner reads them from
GitHub Actions secrets (injected as environment variables by tfaction) and
sets them directly via the Cloudflare API after each `terraform apply`.

## Secrets source of truth: GitHub Actions repository secrets

The following GitHub Actions repository secrets must exist before the first
`terraform apply` (Settings > Secrets and variables > Actions > Repository secrets):

| GitHub Secret name | Env var in apply | Description |
|---|---|---|
| `LOLICE_CF_API_TOKEN` | `CF_API_TOKEN` | Cloudflare API token (Zero Trust: Edit) |
| `LOLICE_RESEND_API_KEY` | `RESEND_API_KEY` | Resend API key for email notifications |

The `null_resource` provisioner reads these environment variables (injected
by the lolice-member-portal entry in `tfaction-root.yaml`) and pushes them
to the Worker via the Cloudflare REST API. Secret values never touch
Terraform state.

## Rotating secrets

To rotate a secret:
1. Update the value in GitHub Actions repository secrets.
2. Run `terraform apply` (or trigger CI) — the provisioner re-applies secrets from the env vars.

> **Warning**: Do NOT update secrets via Wrangler CLI or the Cloudflare
> Dashboard. The next `terraform apply` will overwrite them with the values
> from GitHub Actions secrets.
