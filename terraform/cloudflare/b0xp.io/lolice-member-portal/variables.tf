variable "account_id" {
  description = "The account ID of the Cloudflare account."
  type        = string
  default     = "1984a4314b3e75f3bedce97c7a8e0c81"
}

variable "cf_api_token" {
  description = "Cloudflare API token with Zero Trust Edit permission for dynamic policy updates."
  type        = string
  sensitive   = true
  default     = ""
}

variable "resend_api_key" {
  description = "Resend API key for sending emails (https://resend.com)."
  type        = string
  sensitive   = true
  default     = ""
}
