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

# BOXP-700: コハコ（hermes-agent）が Nature Remo 公式 Cloud API を呼ぶためのアクセストークン置き場。
# 値は本人が https://home.nature.global で発行して直接入れる（terraform は値を管理しない）。
# lolice argoproj/hermes-agent/external-secret-nature-remo.yaml が NATURE_REMO_TOKEN として渡し、
# CLI はこの初期値を「未設定」と扱う。
resource "aws_ssm_parameter" "hermes_agent_nature_remo_token" {
  name        = "/lolice/hermes-agent/nature-remo-token"
  description = "Nature Remo Cloud API access token for the lolice hermes-agent (Kohako)"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"

  tags = {
    Project = "lolice"
    Purpose = "hermes-agent"
  }

  lifecycle {
    ignore_changes = [value]
  }
}
