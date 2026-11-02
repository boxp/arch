output "stage_pages_project_subdomain" {
  description = "The default Cloudflare Pages subdomain for the hitohako stage site."
  value       = cloudflare_pages_project.hitohako_stage.subdomain
}

output "stage_custom_domain" {
  description = "The stage custom domain for the hitohako site."
  value       = local.stage_domain
}
