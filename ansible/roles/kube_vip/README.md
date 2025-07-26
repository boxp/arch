# Kube-VIP Role

This Ansible role installs and configures kube-vip for high availability Virtual IP (VIP) management on Orange Pi Zero 3 Kubernetes clusters.

## Description

Kube-vip provides Kubernetes clusters with a virtual IP for high availability without requiring external hardware load balancers. This role:
- Deploys kube-vip as a static pod on control plane nodes
- Configures ARP-based VIP management
- Supports leader election for active/passive HA
- Enables LoadBalancer service support (optional)
- Auto-detects network interfaces

## Requirements

- Kubernetes cluster initialized with kubeadm
- Control plane nodes with `/etc/kubernetes/admin.conf` present
- NET_ADMIN and NET_RAW capabilities available
- Orange Pi Zero 3 or compatible ARM64 system

## Role Variables

### Required Variables
- `kube_vip_vip`: Virtual IP address for the cluster (e.g., "192.168.10.99")

### Optional Variables
- `kube_vip_version`: Version of kube-vip to deploy (default: "v0.8.9")
- `kube_vip_interface`: Network interface to bind VIP (auto-detected if empty)
- `kube_vip_control_plane`: Enable control plane VIP (default: true)
- `kube_vip_services`: Enable LoadBalancer services (default: false)
- `kube_vip_arp`: Use ARP for VIP management (default: true)
- `kube_vip_leader_elect`: Enable leader election (default: true)
- `kube_vip_log_level`: Logging level (default: "info")
- `kube_vip_rbac_create`: Create RBAC resources (default: true)

## Dependencies

- kubernetes_components role (or existing Kubernetes installation)
- kubernetes.core collection
- community.general collection

## Example Playbook

```yaml
- hosts: control_plane
  become: true
  roles:
    - role: kube_vip
      vars:
        kube_vip_vip: "192.168.10.99"
        kube_vip_interface: "end0"  # Optional, will auto-detect
```

## High Availability Setup

For a multi-master setup:
1. Deploy this role on all control plane nodes
2. All nodes will share the same VIP configuration
3. Leader election ensures only one node holds the VIP at a time
4. Automatic failover occurs if the leader fails

## Testing

This role includes Molecule tests:

```bash
# Run tests locally
cd ansible/roles/kube_vip
molecule test

# Run tests with ARM64 simulation (Orange Pi Zero 3 environment)
MOLECULE_DOCKER_PLATFORM=linux/arm64 molecule test
```

## Network Requirements

- The VIP must be in the same subnet as the control plane nodes
- The VIP must not be assigned to any other device
- ARP broadcasts must be allowed on the network

## Troubleshooting

### Check kube-vip pod status
```bash
kubectl -n kube-system get pod kube-vip
kubectl -n kube-system logs kube-vip
```

### Verify VIP assignment
```bash
ip addr show | grep <VIP>
```

### Check leader election
```bash
kubectl -n kube-system get lease plndr-cp-lock -o yaml
```

## License

MIT

## Author Information

Created for Orange Pi Zero 3 Kubernetes cluster deployment.