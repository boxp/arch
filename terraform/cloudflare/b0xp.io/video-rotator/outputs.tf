output "pages_project_subdomain" {
  description = "The default Cloudflare Pages subdomain for the video rotator."
  value       = cloudflare_pages_project.video_rotator.subdomain
}

output "custom_domain" {
  description = "The custom domain for the video rotator."
  value       = local.custom_domain
}
