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
}

resource "cloudflare_workers_script" "lolice_member_portal" {
  account_id = var.account_id
  name       = "lolice-member-portal"
  content    = file("${path.module}/../../../../apps/lolice-member-portal/src/index.js")
  module     = true

  kv_namespace_binding {
    name         = "PENDING_REQUESTS"
    namespace_id = cloudflare_workers_kv_namespace.pending_requests.id
  }

  d1_database_binding {
    name        = "APPROVED_EMAILS_DB"
    database_id = cloudflare_d1_database.approved_emails.id
  }

  plain_text_binding {
    name = "ADMIN_EMAIL"
    text = "tiyotiyouda@gmail.com"
  }

  plain_text_binding {
    name = "CF_ACCOUNT_ID"
    text = var.account_id
  }

  plain_text_binding {
    name = "CF_APP_ID"
    text = "ccb49999-7a12-476d-8724-0f4cc6a6c0cb"
  }

  plain_text_binding {
    name = "CF_POLICY_ID"
    text = "d807cdcb-141e-40f3-ac82-5b6f97468f19"
  }

  plain_text_binding {
    name = "PORTAL_BASE_URL"
    text = "https://lolice.b0xp.io"
  }
}

# Set Worker secrets from AWS SSM Parameter Store via Cloudflare API.
# Values are read at apply-time by the local-exec provisioner and pushed
# directly to the Worker — they are never stored in Terraform state.
# Triggers re-run whenever the Worker script content changes so that secrets
# are always re-applied after a script update (script updates otherwise
# remove undeclared bindings).
resource "null_resource" "worker_secrets" {
  triggers = {
    script_hash = sha256(file("${path.module}/../../../../apps/lolice-member-portal/src/index.js"))
  }

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail
      ACCOUNT_ID="${var.account_id}"
      for SECRET in CF_API_TOKEN RESEND_API_KEY; do
        VALUE=$(aws ssm get-parameter \
          --name "/lolice-member-portal/$$SECRET" \
          --with-decryption \
          --query Parameter.Value \
          --output text \
          --region ap-northeast-1)
        curl -sf -X PUT \
          "https://api.cloudflare.com/client/v4/accounts/$$ACCOUNT_ID/workers/scripts/lolice-member-portal/secrets" \
          -H "Authorization: Bearer $$CLOUDFLARE_API_TOKEN" \
          -H "Content-Type: application/json" \
          -d "{\"name\":\"$$SECRET\",\"text\":\"$$VALUE\",\"type\":\"secret_text\"}"
        echo "Set secret $$SECRET"
      done
    BASH
  }

  depends_on = [cloudflare_workers_script.lolice_member_portal]
}

resource "cloudflare_worker_route" "lolice_member_portal" {
  zone_id     = "ec593206d0ef695c3aae3a4cb3173264"
  pattern     = "lolice.b0xp.io/*"
  script_name = cloudflare_workers_script.lolice_member_portal.name
}
