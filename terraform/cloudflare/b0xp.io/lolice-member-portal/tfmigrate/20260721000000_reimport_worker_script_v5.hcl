# cloudflare provider v5 cannot decode this Worker's v4 state because it
# contains deprecated empty binding and placement attributes. Forget only the
# Terraform state entry, then import the existing remote Worker using the v5
# schema. The Worker itself is never destroyed.
migration "state" "reimport_worker_script_v5" {
  actions = [
    "rm cloudflare_workers_script.lolice_member_portal",
    "import cloudflare_workers_script.lolice_member_portal 1984a4314b3e75f3bedce97c7a8e0c81/lolice-member-portal",
  ]
  force = true
}
