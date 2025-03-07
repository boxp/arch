variable "bedrock_model_id" {
  description = "AWS Bedrock model ID for Claude 3.7 Sonnet"
  type        = string
  default     = "anthropic.claude-3-7-sonnet-20250219-v1:0"
}

variable "bedrock_region" {
  description = "AWS region where Bedrock is available"
  type        = string
  default     = "us-west-2"
} 