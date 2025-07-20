# Cloudflare CLI Role

This Ansible role installs and configures Cloudflare CLI (cloudflared) on Orange Pi Zero 3 devices for SSH tunnel access.

## Requirements

- Ansible 2.12+
- ARM64 compatible system (Orange Pi Zero 3)
- Internet connectivity for downloading cloudflared binary

## Role Variables

### Required Variables
None - all variables have sensible defaults.

### Optional Variables

```yaml
# Version of cloudflared to install (default: "latest")
cloudflare_cli_version: "latest"

# Installation path for cloudflared binary
cloudflare_cli_install_path: "/usr/local/bin/cloudflared"

# Service configuration (default: false)
cloudflare_cli_enable_service: false
cloudflare_cli_service_name: "cloudflared"
cloudflare_cli_config_dir: "/etc/cloudflared"
cloudflare_cli_log_dir: "/var/log/cloudflared"

# User and group for service
cloudflare_cli_user: "cloudflared"
cloudflare_cli_group: "cloudflared"
```

## Dependencies

None.

## Example Playbook

```yaml
- hosts: control_plane
  become: true
  roles:
    - role: cloudflare_cli
      vars:
        cloudflare_cli_version: "latest"
        cloudflare_cli_enable_service: false
```

## Testing

This role uses Molecule for testing:

```bash
cd roles/cloudflare_cli
molecule test
```

## License

MIT

## Author Information

This role was created for Orange Pi Zero 3 Kubernetes control plane management.