variable "account_id" {
  description = "The account ID of the Cloudflare account."
  type        = string
  default     = "1984a4314b3e75f3bedce97c7a8e0c81"
}

variable "zone_id" {
  description = "The zone ID of the Cloudflare account."
  type        = string
  default     = "ec593206d0ef695c3aae3a4cb3173264"

}

variable "identity_provider_id" {
  description = "GitHub Identity ProviderのID"
  type        = string
  default     = "b9248b7d-c1fa-48ab-8a43-ebffe03fabac"
}
