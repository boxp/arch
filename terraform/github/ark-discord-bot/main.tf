resource "github_repository" "ark_discord_bot" {
  name        = "ark-discord-bot"
  description = "Discord Bot for ARK: Survival Evolved"

  visibility = "public"

  allow_auto_merge       = true
  delete_branch_on_merge = true

  has_issues   = true
  has_projects = false
  has_wiki     = false
}
