# B0XP-23 worker image first boot fixes

## Context

Phase 3 first boot on `golyat-4` proved that the 16GiB GPU worker image can boot from the EVO-T1 internal NVMe and expand rootfs to 1.9T. The smoke test also found first boot gaps that must be fixed in the image before treating the pipeline as production ready.

## Required fixes

- Include RTL8125 support in the image:
  - `linux-modules-extra-*` for the installed generic kernel, providing `r8169`.
  - `linux-firmware`, providing `rtl_nic/rtl8125b-2.fw`.
  - `wireless-regdb`, required by `linux-modules-extra-*`.
- Generate SSH host keys on first boot after `virt-sysprep` removes build-time keys.
- Ensure `/run/sshd` exists before `ssh.service` starts.
- Configure `golyat-4` static networking on `enp44s0` with `192.168.10.107/24` directly via `systemd-networkd`; this node does not require netplan.
- Fix `lolice-grow-rootfs` partition-number detection on Ubuntu 22.04, where `lsblk -o PARTN` is unavailable.
- Prevent kubelet drop-ins from overriding `--node-ip` when adding `--resolv-conf`.
- Include `golyat-4` in normal Ansible plan/apply targets now that SSH access is working.
- Use explicit `chroot_build=true` as the chroot signal so live `golyat-4` plan/apply does not skip runtime module, swap, sysctl, and service tasks.

## Implementation

- Extend `ansible/playbooks/worker-image.yml` with firmware packages, dynamic install of `linux-modules-extra-$kernel`, SSH first-boot service, `tmpfiles.d` rule for `/run/sshd`, direct `systemd-networkd` static network configuration, and grow-rootfs sysfs-based partition number lookup.
- Update `scripts/images/build-gpu-worker-image.sh` so static networking is enabled by default for the GPU worker image and the interface defaults to `enp44s0`.
- Remove worker netplan static config during plan/apply and keep `/etc/systemd/network/20-wired.network` as the managed source.
- Update kubelet systemd drop-ins so `--resolv-conf` uses a separate `KUBELET_RESOLV_CONF_ARGS` variable instead of overwriting `KUBELET_EXTRA_ARGS`.
- Extend `plan-ansible.yml` and `apply-ansible.yml` to include `golyat-4` and select `worker-image.yml` for `golyat-*` targets instead of applying `control-plane.yml`.
- Change worker and Kubernetes component chroot detection to rely on the explicit `chroot_build` variable.

## Verification

- `bash -n scripts/images/build-gpu-worker-image.sh`
- YAML parse for modified Ansible files.
- YAML parse for modified GitHub Actions workflows.
- Ansible syntax-check for `playbooks/worker-image.yml` if `ansible-playbook` is available.
- Future image rebuild smoke:
  - boot `golyat-4` from rebuilt image without manual driver ISO.
  - confirm `ip link` shows RTL8125 ports before manual package installation.
  - confirm `enp44s0` has `192.168.10.107/24`.
  - confirm `ssh boxp@192.168.10.107` works after first boot.
  - confirm `/` expands to roughly 1.9T and `lolice-grow-rootfs.service` does not remain failed.
