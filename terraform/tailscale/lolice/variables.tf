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
