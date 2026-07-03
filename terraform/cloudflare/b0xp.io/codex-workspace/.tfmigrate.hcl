migration_dir = "tfmigrate"
history {
  storage "s3" {
    bucket = "tfaction-state"
    key    = "terraform/cloudflare/b0xp.io/codex-workspace/tfmigrate-history.json"
    region = "ap-northeast-1"
  }
}
