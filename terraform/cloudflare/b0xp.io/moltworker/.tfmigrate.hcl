tfmigrate {
  migration_dir = "./tfmigrate"
  history {
    storage "s3" {
      bucket = "tfaction-history"
      key    = "terraform/cloudflare/b0xp.io/moltworker/history.json"
    }
  }
}
