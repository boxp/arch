# Kubernetes Components Role

This Ansible role installs and configures Kubernetes components (kubeadm, kubelet, kubectl) and CRI-O container runtime for Orange Pi Zero 3 control plane nodes.

## Description

This role provides a complete setup for Kubernetes control plane components including:
- CRI-O container runtime with systemd cgroup driver
- kubeadm for cluster initialization
- kubelet for node management  
- kubectl for cluster interaction
- Proper system configuration (kernel modules, sysctl, swap disable)

## Requirements

- Orange Pi Zero 3 or compatible ARM64 system
- Ubuntu 22.04 LTS or Debian 11/12
- Systemd-based system
- Internet connection for package downloads

## Role Variables

### Kubernetes Configuration
- `kubernetes_version`: Kubernetes version to install (default: "1.28")
- `kubernetes_package_version`: Specific package version (default: "1.28.2-1.1")
- `kubelet_node_ip`: Node IP for kubelet (auto-detected if empty)
- `kubelet_cluster_dns`: Cluster DNS server IP (default: "10.96.0.10")
- `kubelet_cluster_domain`: Cluster domain (default: "cluster.local")

### CRI-O Configuration
- `crio_version`: CRI-O version to install (default: "1.28")
- `container_runtime`: Container runtime to use (default: "cri-o")

### System Configuration
- `kubernetes_disable_swap`: Disable swap for Kubernetes (default: true)
- `kubernetes_enable_modules`: Load required kernel modules (default: true)

## Dependencies

None

## Example Playbook

```yaml
- hosts: orange_pi_control_plane
  become: true
  roles:
    - role: kubernetes_components
      vars:
        kubernetes_version: "1.28"
        kubelet_node_ip: "192.168.1.100"
```

## Testing

This role includes comprehensive Molecule tests:

```bash
# Run tests locally (x86_64)
cd ansible/roles/kubernetes_components
molecule test

# Run tests with ARM64 simulation (Orange Pi Zero 3 environment)
MOLECULE_DOCKER_PLATFORM=linux/arm64 molecule test
```

## License

MIT

## Author Information

Created for Orange Pi Zero 3 Kubernetes cluster deployment.