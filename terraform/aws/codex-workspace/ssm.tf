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
