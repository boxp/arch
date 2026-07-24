output "oracle_cp_1_public_ip" {
  description = "Public IP of oracle-cp-1 (for SSH emergency access)."
  value       = oci_core_instance.oracle_cp_1.public_ip
}

output "oracle_cp_2_public_ip" {
  description = "Public IP of oracle-cp-2 (for SSH emergency access)."
  value       = oci_core_instance.oracle_cp_2.public_ip
}

output "oracle_cp_1_private_ip" {
  description = "Private IP of oracle-cp-1 within OCI VCN."
  value       = oci_core_instance.oracle_cp_1.private_ip
}

output "oracle_cp_2_private_ip" {
  description = "Private IP of oracle-cp-2 within OCI VCN."
  value       = oci_core_instance.oracle_cp_2.private_ip
}

# Tailscale IPs are assigned by the Tailscale control plane after cloud-init runs.
# They cannot be determined from OCI alone. After `terraform apply` + cloud-init
# completes (typically 2-3 min), retrieve them with:
#   tailscale status --json | jq -r '.Peer[] | select(.HostName=="oracle-cp-1") | .TailscaleIPs[0]'
#   tailscale status --json | jq -r '.Peer[] | select(.HostName=="oracle-cp-2") | .TailscaleIPs[0]'
# Update ansible/inventories/production/hosts.yml with these IPs.
output "tailscale_ip_lookup_cmd_cp1" {
  description = "Command to retrieve the Tailscale IP for oracle-cp-1 after cloud-init."
  value       = "tailscale status --json | jq -r '.Peer[] | select(.HostName==\"oracle-cp-1\") | .TailscaleIPs[0]'"
}

output "tailscale_ip_lookup_cmd_cp2" {
  description = "Command to retrieve the Tailscale IP for oracle-cp-2 after cloud-init."
  value       = "tailscale status --json | jq -r '.Peer[] | select(.HostName==\"oracle-cp-2\") | .TailscaleIPs[0]'"
}
