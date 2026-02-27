tfmigrate {
  migration_dir = "./tfmigrate"
  history {
    storage "s3" {
      bucket = "tfaction-history"
      key    = "terraform/tailscale/lolice/history.json"
    }
  }
}
