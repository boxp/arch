# Discord Bot Token をSSMパラメータに保存
resource "aws_ssm_parameter" "discord_bot_token" {
  name        = "/lolice/ark-discord-bot/DISCORD_BOT_TOKEN"
  description = "Discord Bot Token for ARK Discord Bot"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# Discord Channel ID をSSMパラメータに保存
resource "aws_ssm_parameter" "discord_channel_id" {
  name        = "/lolice/ark-discord-bot/DISCORD_CHANNEL_ID"
  description = "Discord Channel ID for ARK Discord Bot"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}

# RCON Password をSSMパラメータに保存
resource "aws_ssm_parameter" "rcon_password" {
  name        = "/lolice/ark-discord-bot/RCON_PASSWORD"
  description = "RCON Password for ARK Server"
  type        = "SecureString"
  value       = "dummy-value-to-be-updated-manually"
  lifecycle {
    ignore_changes = [value]
  }
}