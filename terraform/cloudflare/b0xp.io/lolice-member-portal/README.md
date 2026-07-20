# lolice member portal Worker

Terraform deploys the Worker script and its non-sensitive bindings.
Worker secrets (`CF_API_TOKEN` and `RESEND_API_KEY`) are **not** stored in
Terraform state. Instead, a `null_resource` provisioner reads them from
AWS SSM Parameter Store and sets them directly via the Cloudflare API
after each `terraform apply`.

## Secrets source of truth: AWS SSM Parameter Store

The following SSM parameters must exist before the first `terraform apply`:

| SSM Parameter | Type | Description |
|---|---|---|
| `/lolice-member-portal/CF_API_TOKEN` | SecureString | Cloudflare API token (Zero Trust: Edit) |
| `/lolice-member-portal/RESEND_API_KEY` | SecureString | Resend API key for email notifications |

The `null_resource` provisioner reads these values with decryption via the
AWS CLI (available in the tfaction runner) and pushes them to the Worker via
the Cloudflare REST API. Secret values never touch Terraform state.

## Rotating secrets

To rotate a secret:
1. Update the value in SSM Parameter Store.
2. Run `terraform apply` — the provisioner re-applies secrets from SSM.

> **Warning**: Do NOT update secrets via Wrangler CLI or the Cloudflare
> Dashboard. The next `terraform apply` will overwrite them with the SSM values.
