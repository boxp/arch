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
