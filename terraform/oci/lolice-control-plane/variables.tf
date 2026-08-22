variable "tenancy_ocid" {
  description = "OCI tenancy OCID. Set via TF_VAR_tenancy_ocid or fetched from SSM."
  type        = string
  sensitive   = true
}

variable "user_ocid" {
  description = "OCI user OCID for API key authentication."
  type        = string
  sensitive   = true
}

variable "fingerprint" {
  description = "Fingerprint of the OCI API key."
  type        = string
  sensitive   = true
}

variable "private_key" {
  description = "PEM-encoded private key content for OCI API authentication."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "OCI region. Tokyo is ap-tokyo-1."
  type        = string
  default     = "ap-tokyo-1"
}

variable "compartment_ocid" {
  description = "OCI compartment OCID where resources will be created. Defaults to root compartment (tenancy)."
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "SSH public key to install on the instances for emergency access."
  type        = string
  default     = ""
}

variable "tailscale_auth_key_ssm_path" {
  description = "AWS SSM Parameter Store path for the Tailscale cloud-control-plane auth key."
  type        = string
  default     = "/lolice/tailscale/cloud-control-plane-auth-key"
}
