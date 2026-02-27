# T-20260227-017: Tailscale Operator OAuth credentials Terraform management

## Purpose

Move Tailscale Operator OAuth credentials (client_id / client_secret) from
manual setup to Terraform-managed SSM parameters in boxp/arch, aligning with
the ExternalSecret references in boxp/lolice PR #494.

## Design

### Approach

The Tailscale Terraform provider (v0.28.0) does not provide a resource for
creating OAuth clients. We therefore:

1. Create `aws_ssm_parameter` resources with dummy initial values
2. Use `lifecycle { ignore_changes = [value] }` so Terraform does not
   overwrite the real credentials on subsequent applies
3. Require a one-time manual step to populate real values after the first apply

This follows the established pattern in the repo (see
`terraform/aws/ark-discord-bot/ssm.tf`).

### Changes

#### boxp/arch (this repo)

| File | Change |
|------|--------|
| `terraform/tailscale/lolice/oauth.tf` | New - SSM parameters for operator OAuth client_id and client_secret |
| `terraform/tailscale/lolice/acl.tf` | Add `tag:k8s-operator` to `tagOwners` |

SSM parameter keys:
- `/lolice/tailscale/operator-oauth-client-id`
- `/lolice/tailscale/operator-oauth-client-secret`

#### boxp/lolice (PR #494)

The ExternalSecret in PR #494 already references the correct SSM keys.
No changes required to the ExternalSecret definition.

### Merge order

1. **First**: Merge arch PR (creates SSM parameters)
2. **Then**: Update SSM values with real OAuth credentials (manual one-time step)
3. **Last**: Merge lolice PR #494 (ExternalSecret reads from SSM)

## Operational procedure: eliminating manual setup

### Initial setup (one-time)

1. Merge the arch PR to create SSM parameter placeholders
2. Create an OAuth client in the Tailscale admin console:
   - Go to Settings > OAuth clients
   - Create a new client with scopes: `auth_keys`, `devices`
   - Assign tag: `tag:k8s-operator`
3. Update SSM parameters with real values:
   ```bash
   aws ssm put-parameter \
     --name "/lolice/tailscale/operator-oauth-client-id" \
     --value "<CLIENT_ID>" --type SecureString --overwrite

   aws ssm put-parameter \
     --name "/lolice/tailscale/operator-oauth-client-secret" \
     --value "<CLIENT_SECRET>" --type SecureString --overwrite
   ```
4. Merge lolice PR #494 to deploy the operator

### Ongoing

- Credentials are auto-synced to Kubernetes via ExternalSecret (1h refresh)
- Terraform manages parameter existence; values are manually maintained
- No manual Kubernetes secret creation needed
