tfmigrate {
  migration_dir = "./tfmigrate"
  history {
    storage "s3" {
      bucket = "tfaction-history"
      key    = "%%TARGET%%/history.json"
    }
  }
}
