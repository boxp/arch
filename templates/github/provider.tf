provider "github" {
  owner = var.github_owner
  # token pulled from $GITHUB_TOKEN
}

variable "github_owner" {
  description = "GitHub owner (user or organization)"
  type        = string
}
