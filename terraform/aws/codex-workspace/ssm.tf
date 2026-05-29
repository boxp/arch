resource "aws_ssm_parameter" "even_terminal_token" {
  name        = "/lolice/codex-workspace/even-terminal-token"
  description = "Even Terminal authentication token for the lolice Codex workspace"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"

  tags = {
    Project = "lolice"
    Purpose = "codex-workspace"
  }

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "gemini_api_key" {
  name        = "/lolice/codex-workspace/gemini-api-key"
  description = "Gemini API key for image generation in the lolice Codex workspace"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"

  tags = {
    Project = "lolice"
    Purpose = "codex-workspace"
  }

  lifecycle {
    ignore_changes = [value]
  }
}
