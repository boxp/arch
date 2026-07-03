migration_dir = "tfmigrate"
history {
  storage "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/even-g2-lab/tfmigrate-history.json"
    region = "ap-northeast-1"
  }
}
