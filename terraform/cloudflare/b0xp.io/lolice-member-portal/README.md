# lolice member portal Worker

Terraform deploys the Worker script and its non-sensitive bindings.

## Worker Secrets

Worker secrets (`CF_API_TOKEN` and `RESEND_API_KEY`) are set manually via the
Cloudflare Dashboard or Wrangler CLI and are **not managed by Terraform**.

To set or rotate a secret:
1. Go to Cloudflare Dashboard > Workers & Pages > lolice-member-portal > Settings > Variables
2. Add or update the secret values under "Secrets"

> **Note**: When `terraform apply` updates the Worker script, manually-set secret bindings
> that are not declared in Terraform may be removed. If secrets disappear after an apply,
> re-add them via the Dashboard.

| Secret name | Description |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token (Zero Trust: Edit) |
| `RESEND_API_KEY` | Resend API key for email notifications |
