tfmigrate {
  migration_dir = "./tfmigrate"
  history {
    storage "s3" {
      bucket = "tfaction-history"
      key    = "/history.json"
    }
  }
}
