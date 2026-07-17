resource "cloudflare_workers_kv_namespace" "pending_requests" {
  account_id = var.account_id
  title      = "lolice-member-portal-pending-requests"
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

  durable_object_namespace_binding {
    name       = "POLICY_UPDATE_DO"
    class_name = "PolicyUpdateDO"
  }

  secret_text_binding {
    name = "CF_API_TOKEN"
    text = var.cf_api_token
  }

  secret_text_binding {
    name = "RESEND_API_KEY"
    text = var.resend_api_key
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

  migrations {
    tag         = "v1"
    new_classes = ["PolicyUpdateDO"]
  }
}

resource "cloudflare_worker_route" "lolice_member_portal" {
  zone_id     = "ec593206d0ef695c3aae3a4cb3173264"
  pattern     = "lolice.b0xp.io/*"
  script_name = cloudflare_workers_script.lolice_member_portal.name
}
