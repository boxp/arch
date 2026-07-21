moved {
  from = cloudflare_record.lolice_member_portal
  to   = cloudflare_dns_record.lolice_member_portal
}

moved {
  from = cloudflare_worker_route.lolice_member_portal
  to   = cloudflare_workers_route.lolice_member_portal
}
