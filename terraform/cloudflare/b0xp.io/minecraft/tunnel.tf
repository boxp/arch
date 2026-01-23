# Secret for the tunnel
resource "random_password" "tunnel_secret" {
  length = 64
}

# Minecraft BlueMap用のトンネルを作成
resource "cloudflare_tunnel" "minecraft_map_tunnel" {
  account_id = var.account_id
  name       = "cloudflare minecraft-map tunnel"
  secret     = sensitive(base64sha256(random_password.tunnel_secret.result))
}

# Minecraft BlueMap用トンネル設定
resource "cloudflare_tunnel_config" "minecraft_map_tunnel" {
  tunnel_id  = cloudflare_tunnel.minecraft_map_tunnel.id
  account_id = var.account_id
  config {
    ingress_rule {
      # Hostname from dns.tf
      hostname = cloudflare_record.minecraft_map.hostname
      # Internal BlueMap service address
      service = "http://minecraft-bluemap.minecraft.svc.cluster.local:8100"
    }
    # Default rule: return 404 for unmatched requests
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# Minecraft BlueMap用トンネルトークンをSSMに保存
resource "aws_ssm_parameter" "minecraft_tunnel_token" {
  name        = "minecraft-tunnel-token"
  description = "Cloudflare tunnel token for Minecraft BlueMap"
  type        = "SecureString"
  value       = sensitive(cloudflare_tunnel.minecraft_map_tunnel.tunnel_token)
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
