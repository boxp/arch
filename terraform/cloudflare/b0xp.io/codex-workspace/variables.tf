variable "account_id" {
  description = "The account ID of the Cloudflare account."
  type        = string
  default     = "1984a4314b3e75f3bedce97c7a8e0c81"
}

variable "cloudflare_zero_trust_team_name" {
  description = "The Cloudflare Zero Trust team name used by WARP MDM organization."
  type        = string
  default     = "boxp"
}
