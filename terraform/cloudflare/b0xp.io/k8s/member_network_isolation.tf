# BOXP-330: lolice members (game server participants) may only reach the game
# servers over WARP.
#
# Live state before this change (read with data sources on boxp/arch#14171):
# - Every enrolled device (Owner, members, codex-workspace) uses the same
#   default device profile, which includes management hosts in 192.168.10.*.
# - The "boxp-home" tunnel routes 192.168.10.0/24 and there were no Gateway
#   network policies, so every enrolled identity could reach every routed host.
#
# Split tunnels only decide routing, so authorization is enforced here with
# Gateway network policies (TCP and UDP proxy are enabled in device settings):
# 1. members -> published game sockets: allow
# 2. members -> any private/internal range: block (deny by default)
#
# Members are identified by the WARP enrollment Access policy ("mail
# addresses", maintained by the lolice-member-portal Worker) minus the Owner.
# The Owner (also the portal admin) and service-token devices
# (codex-workspace) are never in the list, so their access is unchanged.
# Terraform only seeds the list when it is created (ignore_changes = [items]);
# afterwards the Worker is the single writer and appends newly approved members
# before enrolling them (fail closed). Letting Terraform rewrite the whole set
# on every apply could race with an approval and drop a just-approved member.
# The check block below warns when an enrolled member is missing from the list
# (e.g. someone added to the Access policy outside the portal).

data "cloudflare_zero_trust_access_applications" "lolice_member" {
  account_id = var.account_id
  max_items  = 1000
}

locals {
  # Owner/admin identities that must never be restricted, even when they are
  # also listed in the member enrollment policy.
  lolice_owner_emails = ["tiyotiyouda@gmail.com"]

  # WARP enrollment policy that the lolice-member-portal Worker appends
  # approved members to (CF_POLICY_ID in ../lolice-member-portal/worker.tf).
  lolice_member_enrollment_policy_id = "d807cdcb-141e-40f3-ac82-5b6f97468f19"

  lolice_member_enrollment_policy = one(flatten([
    for app in data.cloudflare_zero_trust_access_applications.lolice_member.result : [
      for policy in coalesce(app.policies, []) : policy
      if policy.id == local.lolice_member_enrollment_policy_id
    ] if app.type == "warp"
  ]))

  lolice_member_emails = sort(setsubtract(
    distinct([
      for rule in local.lolice_member_enrollment_policy.include : lower(rule.email.email)
      if try(rule.email.email, null) != null
    ]),
    [for email in local.lolice_owner_emails : lower(email)],
  ))

  # Game data plane: Services running in boxp/lolice and/or published on the
  # member portal guide (apps/lolice-member-portal/public/guide.html).
  # RCON (ARK 27020/TCP, Minecraft 25575/TCP) and the unpublished ARK
  # 7778/27015 and StarRupture (.31, not deployed) are intentionally absent.
  lolice_member_game_sockets = [
    { ip = "192.168.10.97", port = 8211, protocol = "udp" },  # PalWorld 1
    { ip = "192.168.10.108", port = 8211, protocol = "udp" }, # PalWorld 2
    { ip = "192.168.10.29", port = 7777, protocol = "udp" },  # ARK: Survival Ascended
    { ip = "192.168.10.30", port = 25565, protocol = "tcp" }, # Minecraft (published, currently scaled to 0)
  ]

  # Private and internal ranges members must not reach through WARP.
  lolice_member_denied_networks = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "100.64.0.0/10",
    "fc00::/7",
    "fe80::/10",
  ]

  lolice_member_identity = format("identity.email in $%s", cloudflare_zero_trust_list.lolice_members.id)
}

resource "cloudflare_zero_trust_list" "lolice_members" {
  account_id  = var.account_id
  name        = "lolice-members"
  type        = "EMAIL"
  description = "BOXP-330: lolice game server participants (WARP enrollment policy minus Owner). Used by Gateway network policies."
  # Member addresses are personal data and the repository/plan comments are
  # public, so the items are hidden from plan output.
  items = sensitive([
    for email in local.lolice_member_emails : {
      value       = email
      description = "lolice member"
    }
  ])

  lifecycle {
    ignore_changes = [items]
  }
}

check "lolice_members_cover_enrollment" {
  data "cloudflare_zero_trust_list" "lolice_members_live" {
    account_id = var.account_id
    list_id    = cloudflare_zero_trust_list.lolice_members.id
  }

  assert {
    condition = length(setsubtract(
      local.lolice_member_emails,
      [for item in coalesce(data.cloudflare_zero_trust_list.lolice_members_live.items, []) : lower(item.value)],
    )) == 0
    # Only a count: member addresses must not appear in public plan output.
    error_message = format(
      "%d enrolled lolice member(s) are missing from the lolice-members Gateway list and are not restricted. Add them to the list (Zero Trust > Lists) or re-approve them through the portal.",
      length(setsubtract(
        local.lolice_member_emails,
        [for item in coalesce(data.cloudflare_zero_trust_list.lolice_members_live.items, []) : lower(item.value)],
      )),
    )
  }
}

resource "cloudflare_zero_trust_gateway_policy" "lolice_member_allow_game" {
  account_id  = var.account_id
  name        = "lolice members: allow game servers"
  description = "BOXP-330: lolice members may reach only the published game server sockets"
  action      = "allow"
  enabled     = true
  filters     = ["l4"]
  precedence  = 2000
  identity    = local.lolice_member_identity
  traffic = join(" or ", [
    for socket in local.lolice_member_game_sockets :
    format("(net.dst.ip == %s and net.dst.port == %d and net.protocol == \"%s\")", socket.ip, socket.port, socket.protocol)
  ])
}

resource "cloudflare_zero_trust_gateway_policy" "lolice_member_block_private" {
  account_id  = var.account_id
  name        = "lolice members: block private networks"
  description = "BOXP-330: deny-by-default for lolice members to private networks (management hosts, nodes, Kubernetes, other routes)"
  action      = "block"
  enabled     = true
  filters     = ["l4"]
  precedence  = 2010
  identity    = local.lolice_member_identity
  traffic     = format("net.dst.ip in {%s}", join(" ", local.lolice_member_denied_networks))

  depends_on = [cloudflare_zero_trust_gateway_policy.lolice_member_allow_game]
}
