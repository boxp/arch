moved {
  from = cloudflare_record.video_rotator
  to   = cloudflare_dns_record.video_rotator
}

moved {
  from = cloudflare_record.video_rotator_dev
  to   = cloudflare_dns_record.video_rotator_dev
}
