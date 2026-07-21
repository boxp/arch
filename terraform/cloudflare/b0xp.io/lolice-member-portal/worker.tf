# Last synced with apps/lolice-member-portal/src/index.js: 2026-07-21

resource "cloudflare_workers_kv_namespace" "pending_requests" {
  account_id = var.account_id
  title      = "lolice-member-portal-pending-requests"
}

# D1 database for strongly consistent approved-email storage.
# Replacing the previous KV namespace which had eventual-consistency issues
# that could cause concurrent approvals to lose each other's entries.
resource "cloudflare_d1_database" "approved_emails" {
  account_id = var.account_id
  name       = "lolice-member-portal-approved-emails"
  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_workers_script" "lolice_member_portal" {
  account_id  = var.account_id
  script_name = "lolice-member-portal"
  content     = file("${path.module}/../../../../apps/lolice-member-portal/src/index.js")
  main_module = "index.js"
  # Worker secrets are configured outside Terraform and must survive script
  # uploads performed by this resource.
  keep_bindings = ["secret_text"]

  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled            = true
      invocation_logs    = true
      head_sampling_rate = 1
      persist            = true
    }
  }

  bindings = [
    {
      name         = "PENDING_REQUESTS"
      type         = "kv_namespace"
      namespace_id = cloudflare_workers_kv_namespace.pending_requests.id
    },
    {
      name = "APPROVED_EMAILS_DB"
      type = "d1"
      id   = cloudflare_d1_database.approved_emails.id
    },
    {
      name = "ADMIN_EMAIL"
      type = "plain_text"
      text = "tiyotiyouda@gmail.com"
    },
    {
      name = "CF_ACCOUNT_ID"
      type = "plain_text"
      text = var.account_id
    },
    {
      name = "CF_APP_ID"
      type = "plain_text"
      text = "ccb49999-7a12-476d-8724-0f4cc6a6c0cb"
    },
    {
      name = "CF_POLICY_ID"
      type = "plain_text"
      text = "d807cdcb-141e-40f3-ac82-5b6f97468f19"
    },
    {
      name = "PORTAL_BASE_URL"
      type = "plain_text"
      text = "https://lolice.b0xp.io"
    },
  ]
}

# Verify that required Worker secrets are still bound after each script update.
# Uses $CLOUDFLARE_API_TOKEN (already available in the Terraform CI environment)
# to list secret names — values are never exposed. Fails CI loudly if either
# secret is missing, so the issue is caught before the Worker silently breaks.
resource "null_resource" "verify_worker_secrets" {
  triggers = {
    script_hash = sha256(file("${path.module}/../../../../apps/lolice-member-portal/src/index.js"))
    # Re-run the post-deploy secret binding verification after the v5 state migration.
    worker_settings_version = "v5-observability-deployed"
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail
      SECRETS=$(curl -sf \
        "https://api.cloudflare.com/client/v4/accounts/${var.account_id}/workers/scripts/lolice-member-portal/secrets" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        | jq -r '.result[].name // empty')
      MISSING=()
      for SECRET in CF_API_TOKEN RESEND_API_KEY; do
        if ! echo "$SECRETS" | grep -qx "$SECRET"; then
          MISSING+=("$SECRET")
        fi
      done
      if [ $${#MISSING[@]} -gt 0 ]; then
        echo "ERROR: The following Worker secrets are missing after terraform apply: $${MISSING[*]}"
        echo "Re-add them via: Cloudflare Dashboard > Workers & Pages > lolice-member-portal > Settings > Variables > Secrets"
        exit 1
      fi
      echo "Worker secrets verified: CF_API_TOKEN and RESEND_API_KEY are present."
    BASH
  }

  depends_on = [cloudflare_workers_script.lolice_member_portal]
}

resource "cloudflare_workers_route" "lolice_member_portal" {
  zone_id = "ec593206d0ef695c3aae3a4cb3173264"
  pattern = "lolice.b0xp.io/*"
  script  = cloudflare_workers_script.lolice_member_portal.script_name
}
