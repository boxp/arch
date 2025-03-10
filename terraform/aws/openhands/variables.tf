variable "region" {
  description = "AWS region"
  type        = string
  default     = "asia-northeast-1"
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
  default     = "839695154978"
}

variable "google_api_key" {
  description = "Google API Key for OpenHands"
  type        = string
  sensitive   = true
}
