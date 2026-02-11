# Anthropic API Key をSSMパラメータに保存 (LiteLLMのみが使用)
resource "aws_ssm_parameter" "anthropic_api_key" {
  name        = "/lolice/openclaw/ANTHROPIC_API_KEY"
  description = "Anthropic API Key for LiteLLM proxy (OpenClaw LLM provider)"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# Discord Bot Token をSSMパラメータに保存
resource "aws_ssm_parameter" "discord_bot_token" {
  name        = "/lolice/openclaw/DISCORD_BOT_TOKEN"
  description = "Discord Bot Token for OpenClaw"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# OpenClaw Gateway Token をSSMパラメータに保存
resource "aws_ssm_parameter" "openclaw_gateway_token" {
  name        = "/lolice/openclaw/OPENCLAW_GATEWAY_TOKEN"
  description = "Gateway authentication token for OpenClaw"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# LiteLLM Master Key をSSMパラメータに保存
resource "aws_ssm_parameter" "litellm_master_key" {
  name        = "/lolice/openclaw/LITELLM_MASTER_KEY"
  description = "LiteLLM master key for administration"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# LiteLLM Proxy Key をSSMパラメータに保存
resource "aws_ssm_parameter" "litellm_proxy_key" {
  name        = "/lolice/openclaw/LITELLM_PROXY_KEY"
  description = "LiteLLM proxy key for inference requests"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# GitHub Token をSSMパラメータに保存
resource "aws_ssm_parameter" "github_token" {
  name        = "/lolice/openclaw/GITHUB_TOKEN"
  description = "GitHub PAT for OpenClaw"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# Discord Allowed User IDs をSSMパラメータに保存 (DM allowlist用)
resource "aws_ssm_parameter" "discord_allowed_user_ids" {
  name        = "/lolice/openclaw/DISCORD_ALLOWED_USER_IDS"
  description = "Discord user ID allowed to DM the OpenClaw bot"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# OpenAI API Key をSSMパラメータに保存 (Codex CLI用)
resource "aws_ssm_parameter" "openai_api_key" {
  name        = "/lolice/openclaw/OPENAI_API_KEY"
  description = "OpenAI API Key for Codex CLI"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# Claude Code OAuth Token をSSMパラメータに保存 (Max Plan認証用)
resource "aws_ssm_parameter" "claude_code_oauth_token" {
  name        = "/lolice/openclaw/CLAUDE_CODE_OAUTH_TOKEN"
  description = "Claude Code OAuth token for Max Plan authentication"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}
