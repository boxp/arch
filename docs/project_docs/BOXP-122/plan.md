# Cloudflare provider v5 migration plan

1. Update every Cloudflare Terraform module to require provider version `~> 5.0`.
2. Rename affected DNS, Zero Trust Access, and Cloudflared tunnel resources and their references.
3. Add `moved` blocks only for resources renamed by this migration, excluding pre-existing v5 resources.
4. Replace legacy page rules with redirect rulesets and correct the Grafana DNS record attribute.
5. Format and validate the changed Terraform configurations, then commit and open the requested PR.
