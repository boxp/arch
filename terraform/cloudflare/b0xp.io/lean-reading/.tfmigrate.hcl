migration_dir = "tfmigrate"
history {
  storage "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/lean-reading/tfmigrate-history.json"
    region = "ap-northeast-1"
  }
}
