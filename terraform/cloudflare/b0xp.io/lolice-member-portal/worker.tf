# Read secrets from AWS SSM Parameter Store so that Terraform always declares
# the secret bindings. Without this, updating cloudflare_workers_script would
# delete any manually-set CF_API_TOKEN / RESEND_API_KEY bindings.
# Prerequisites: SSM parameters created by boxp before first apply:
#   /lolice-member-portal/CF_API_TOKEN   (SecureString)
#   /lolice-member-portal/RESEND_API_KEY (SecureString)
data "aws_ssm_parameter" "cf_api_token" {
  name            = "/lolice-member-portal/CF_API_TOKEN"
  with_decryption = true
}

data "aws_ssm_parameter" "resend_api_key" {
  name            = "/lolice-member-portal/RESEND_API_KEY"
  with_decryption = true
}

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

resource "cloudflare_workers_secret" "cf_api_token" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.lolice_member_portal.name
  name        = "CF_API_TOKEN"
  secret_text = data.aws_ssm_parameter.cf_api_token.value
}

resource "cloudflare_workers_secret" "resend_api_key" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.lolice_member_portal.name
  name        = "RESEND_API_KEY"
  secret_text = data.aws_ssm_parameter.resend_api_key.value
}

resource "cloudflare_worker_route" "lolice_member_portal" {
  zone_id     = "ec593206d0ef695c3aae3a4cb3173264"
  pattern     = "lolice.b0xp.io/*"
  script_name = cloudflare_workers_script.lolice_member_portal.name
}
