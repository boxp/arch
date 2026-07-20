# lolice member portal Worker

Terraform deploys the Worker script and its non-sensitive bindings. It does
not manage Worker secrets: passing secret values through Terraform would store
them in Terraform state.

After the Worker has been created or updated, set the following secrets
manually for the `lolice-member-portal` Worker:

- `CF_API_TOKEN` — Cloudflare API token used to update the Access policy
- `RESEND_API_KEY` — Resend API key used to send notification emails

## Wrangler CLI

Authenticate with an account that can edit the Worker, then run the following
commands from this directory. Each command prompts for the value and does not
write it to the shell history.

```sh
wrangler secret put CF_API_TOKEN --name lolice-member-portal
wrangler secret put RESEND_API_KEY --name lolice-member-portal
```

## Cloudflare Dashboard

Open **Workers & Pages** → **lolice-member-portal** → **Settings** →
**Variables and Secrets**, then add each value above as an encrypted secret.

Repeat this step whenever either secret is rotated. Do not put secret values in
Terraform variables, `plain_text_binding`, or `.tfvars` files.
