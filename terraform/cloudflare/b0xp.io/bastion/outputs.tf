output "tunnel_id" {
  description = "The Cloudflare Tunnel ID for bastion"
  value       = cloudflare_zero_trust_tunnel_cloudflared.bastion.id
}

output "tunnel_cname" {
  description = "The CNAME for the Cloudflare Tunnel"
  value       = "${cloudflare_zero_trust_tunnel_cloudflared.bastion.id}.cfargotunnel.com"
}

output "access_application_id" {
  description = "The Cloudflare Access Application ID"
  value       = cloudflare_zero_trust_access_application.bastion.id
}

output "dns_record_hostname" {
  description = "The DNS hostname for bastion"
  value       = cloudflare_dns_record.bastion.name
}
