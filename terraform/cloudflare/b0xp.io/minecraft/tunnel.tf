# Secret for the tunnel
resource "random_password" "tunnel_secret" {
  length = 64
}

# Minecraft BlueMap用のトンネルを作成
resource "cloudflare_zero_trust_tunnel_cloudflared" "minecraft_map_tunnel" {
  account_id = var.account_id
  name       = "cloudflare minecraft-map tunnel"
  tunnel_secret = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Minecraft BlueMap用トンネル設定
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "minecraft_map_tunnel" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.minecraft_map_tunnel.id
  account_id = var.account_id
  config = {
  ingress = [
    {
      # Hostname from dns.tf
      hostname = cloudflare_dns_record.minecraft_map.name
      # Internal BlueMap service address
      service = "http://minecraft-bluemap.minecraft.svc.cluster.local:8100"
    },
    {
      service = "http_status:404"
    },
  ]

  }
}

# Minecraft BlueMap用トンネルトークンをSSMに保存

data "cloudflare_zero_trust_tunnel_cloudflared_token" "minecraft_map_tunnel" {
  account_id = var.account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.minecraft_map_tunnel.id
}
resource "aws_ssm_parameter" "minecraft_tunnel_token" {
  name        = "minecraft-tunnel-token"
  description = "Cloudflare tunnel token for Minecraft BlueMap"
  type        = "SecureString"
  value       = sensitive(data.cloudflare_zero_trust_tunnel_cloudflared_token.minecraft_map_tunnel.token)
}

# RCON password for Minecraft server administration
resource "random_password" "rcon_password" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "minecraft_rcon_password" {
  name        = "minecraft-rcon-password"
  description = "RCON password for Minecraft server"
  type        = "SecureString"
  value       = sensitive(random_password.rcon_password.result)
}
