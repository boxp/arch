# cloudflare provider v5 cannot decode the v4 state for the Worker and D1
# database. Forget only their Terraform state entries, then import the existing
# remote resources using the v5 schema. Neither resource is destroyed.
migration "state" "reimport_lolice_member_portal_resources_v5" {
  actions = [
    "rm cloudflare_workers_script.lolice_member_portal",
    "import cloudflare_workers_script.lolice_member_portal 1984a4314b3e75f3bedce97c7a8e0c81/lolice-member-portal",
    "rm cloudflare_d1_database.approved_emails",
    "import cloudflare_d1_database.approved_emails 1984a4314b3e75f3bedce97c7a8e0c81/eb362715-ea59-4618-aaf3-d42b8c4c13dc",
  ]
  force = true
}
