# Ansible Configuration for Control Plane Nodes

This directory contains Ansible playbooks and roles for managing Kubernetes control plane nodes on Orange Pi Zero 3 devices.

## Test CI Integration

## Overview

The Ansible configuration manages:
- User creation and SSH access
- Network configuration (static IPs, disable WiFi/Bluetooth)
- Cloudflare CLI for SSH tunneling
- Kubernetes components (kubeadm, kubelet, cri-o)

## Target Nodes

- `shanghai-1` (192.168.10.102)
- `shanghai-2` (192.168.10.103)
- `shanghai-3` (192.168.10.104)

All nodes are Orange Pi Zero 3 devices running Armbian.

## Prerequisites

1. Install uv (Python package manager):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. Install Python dependencies:
   ```bash
   cd ansible
   uv sync
   source .venv/bin/activate
   ```

## Directory Structure

```
ansible/
├── inventories/
│   └── production/
│       └── hosts.yml          # Inventory with node definitions
├── playbooks/
│   ├── control-plane.yml      # Main playbook (initial setup)
│   └── upgrade-k8s.yml        # Kubernetes cluster upgrade playbook
├── roles/
│   ├── user_management/       # User and SSH configuration
│   ├── network_configuration/ # Network settings
│   ├── kubernetes_components/ # Kubernetes installation
│   └── kubernetes_upgrade/    # Kubernetes upgrade automation
├── group_vars/
│   └── control_plane.yml      # Group variables
└── requirements.yml           # Ansible collections
```

## Usage

### Run the complete playbook

```bash
cd ansible
source .venv/bin/activate
ansible-playbook playbooks/control-plane.yml
```

### Run specific roles

```bash
# Only configure users
ansible-playbook playbooks/control-plane.yml --tags users

# Only configure network
ansible-playbook playbooks/control-plane.yml --tags network
```

### Upgrade Kubernetes cluster

```bash
ansible-playbook playbooks/upgrade-k8s.yml \
  -e kubernetes_upgrade_version=1.35.1 \
  -e kubernetes_upgrade_package=1.35.1-1.1 \
  -e crio_upgrade_version=1.35.0
```

Run pre-checks only:

```bash
ansible-playbook playbooks/upgrade-k8s.yml --tags pre_checks \
  -e kubernetes_upgrade_version=1.35.1 \
  -e kubernetes_upgrade_package=1.35.1-1.1
```

See the [Kubernetes Update Automation Plan](../docs/project_docs/k8s-update-automation/plan.md) for details.

### Test with Molecule

Each role includes Molecule tests for TDD with Orange Pi Zero 3 simulation:

```bash
cd ansible/roles/user_management
source ../../.venv/bin/activate
molecule test
```

**Note**: Tests simulate Orange Pi Zero 3 environment using Debian containers with ARM64-compatible settings and hardware simulation.

## Roles

### user_management
- Creates `boxp` user with sudo privileges
- **GitHub Integration**: Automatically fetches SSH keys from `github.com/{username}.keys`
- **Manual Option**: Supports manual SSH key configuration
- Sets up passwordless sudo

### network_configuration
- Configures static IP addresses
- Sets up DNS servers
- Disables WiFi and Bluetooth
- Creates systemd service to persist wireless settings

### kubernetes_upgrade
- Automates Kubernetes cluster upgrades (kubeadm upgrade apply/node)
- Pre-upgrade validation (etcd health, node readiness)
- etcd snapshot for rollback safety
- Rolling drain/uncordon of control plane nodes
- Post-upgrade health checks (node Ready, kubelet version, etcd health)
- Rollback support via etcd snapshot restore
- Tag-based partial execution (`pre_checks`, `etcd_snapshot`, `upgrade`, `health_check`, `rollback`)

## Development

This project follows TDD practices:
1. Write Molecule tests first
2. Implement Ansible roles to pass tests
3. Run `ansible-lint` for code quality
4. All changes are tested in CI/CD

## CI/CD

GitHub Actions workflow runs on every PR:
- ansible-lint for code quality
- Molecule tests for all roles
- Validates playbook syntax

## Variables

Key variables to configure in `group_vars/control_plane.yml`:

### GitHub SSH Key Integration (Recommended)
```yaml
user_management_use_github_keys: true
user_management_github_username: "boxp"
```

### Manual SSH Key (Alternative)
```yaml
user_management_use_github_keys: false
user_management_ssh_key: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC... boxp@example.com"
```

### Other Variables
- `kubernetes_version`: Kubernetes version to install
- `crio_version`: CRI-O version to install

### Upgrade Variables (for `upgrade-k8s.yml`)
- `kubernetes_upgrade_version`: Target Kubernetes version (e.g., `"1.35.1"`)
- `kubernetes_upgrade_package`: Target package version (e.g., `"1.35.1-1.1"`)
- `crio_upgrade_version`: Target CRI-O version (e.g., `"1.35.0"`)
- `kubernetes_previous_version`: Previous version for rollback (e.g., `"1.34"`)
- `kubernetes_previous_package`: Previous package version for rollback (e.g., `"1.34.0-1.1"`)

## Security Notes

- All nodes use SSH access via Cloudflare Tunnel
- WiFi and Bluetooth are disabled for security
- boxp user has passwordless sudo (configure carefully)