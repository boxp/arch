variable "argocd_service_cluster_ip" {
  description = "The ClusterIP of the ArgoCD Server service in the lolice cluster."
  type        = string
  default     = "" # To be set after subnet router deployment
}

variable "github_repository" {
  description = "The GitHub repository for WIF trust (e.g. boxp/lolice)."
  type        = string
  default     = "boxp/lolice"
}

variable "argocd_diff_workflow_name" {
  description = "The name of the ArgoCD diff workflow for WIF custom claim rules."
  type        = string
  default     = "ArgoCD Diff Check"
}

# ── Workload Identity Federation for K8s Operator ───────────────────

variable "k8s_sa_jwks_json" {
  description = <<-EOT
    JWKS JSON containing the Kubernetes service-account signing public
    key.  Extract from a control-plane node with:
      kubectl get --raw /openid/v1/jwks
    Leave as the default placeholder until the cluster is configured.
  EOT
  type        = string
  default     = "{\"keys\":[]}"
}
