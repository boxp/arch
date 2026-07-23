moved {
  from = cloudflare_record.root
  to   = cloudflare_dns_record.root
}

moved {
  from = cloudflare_record.www
  to   = cloudflare_dns_record.www
}

moved {
  from = cloudflare_record.hitohub
  to   = cloudflare_dns_record.hitohub
}
