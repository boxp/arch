variable "account_id" {
  description = "The account ID of the Cloudflare account."
  type        = string
  default     = "1984a4314b3e75f3bedce97c7a8e0c81"
}

variable "cloudflare_zero_trust_team_name" {
  description = "The Cloudflare Zero Trust team name used by WARP MDM organization."
  type        = string
  default     = "b0xp"
}

variable "cloudflare_one_client_access_application_domain" {
  description = "The existing Cloudflare One Client Access application domain used for WARP device enrollment permissions."
  type        = string
  default     = "b0xp.cloudflareaccess.com/warp"
}
