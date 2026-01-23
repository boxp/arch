output "tunnel_id" {
  description = "The Cloudflare Tunnel ID for bastion"
  value       = cloudflare_tunnel.bastion.id
}

output "tunnel_cname" {
  description = "The CNAME for the Cloudflare Tunnel"
  value       = cloudflare_tunnel.bastion.cname
}

output "access_application_id" {
  description = "The Cloudflare Access Application ID"
  value       = cloudflare_access_application.bastion.id
}

output "dns_record_hostname" {
  description = "The DNS hostname for bastion"
  value       = cloudflare_record.bastion.hostname
}
