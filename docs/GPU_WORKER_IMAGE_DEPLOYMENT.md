# GPU Worker Image Deployment

This document covers the amd64 worker image artifact, flash procedure, and recovery gates. It started as the Phase 2 document for the golyat-4 GPU worker (BOXP-23); since BOXP-269 the same pipeline builds a per-node image for every golyat worker. It defines the procedure only; writing a node's internal disk is a destructive operation that needs its own approval (BOXP-269 G2 for golyat-1..3).

## Worker nodes

Per-node values come from `ansible/vars/worker_nodes.yml` (`worker_nodes.<node>`: `ip`, `interface`, `gpu_host_tools`). The build script and the image verifier read the same file, so a node is added or changed there, never in the workflow. The file is separate from the shared `ansible/vars/nodes.yml` on purpose: editing it resolves to a worker-only `apply-ansible` run, while `nodes.yml` is loaded by the control plane playbooks as well (a worker listed in both must have the same IP; the playbook asserts it).

| node | IP | NIC (`interface`) | GPU host tools | target disk (read from the node, verify again before flashing) |
|---|---|---|---|---|
| golyat-1 | 192.168.10.101 | `enp3s0` (Intel I225-V) | no | NVMe MasonSemi 238.5G |
| golyat-2 | 192.168.10.105 | `enx207bd2213354` (USB Ethernet, ax88179_178a) | no | SATA SSD Samsung MZNTY256 238.5G |
| golyat-3 | 192.168.10.106 | `enp3s0` (Intel I226-V) | no | NVMe AirDisk 256GB |
| golyat-4 | 192.168.10.107 | `enp44s0` (RTL8125) | yes | NVMe YMTC PC411 2TB |

Notes:

- golyat-2's production link is a USB adapter, so the interface name is derived from the adapter MAC. Replacing the adapter changes the name and requires a rebuild. The onboard `enp0s31f6` is unused.
- The noble image has not yet been first-booted on golyat-1..3 hardware (N100 / i5-6200U, USB NIC on kernel 6.8). A successful build and content verification is not a substitute for that check.
- golyat-1..3 are **not** targets of `plan-ansible` / `apply-ansible`; adding them is BOXP-269 G1 and a separate change.

## Build

Run the workflow manually (`install_gpu_host_tools=auto` picks the value from `worker_nodes`):

```bash
gh workflow run build-gpu-worker-image.yml \
  -f node_name=golyat-1 \
  -f base_release=noble \
  -f image_size=16G \
  -f install_gpu_host_tools=auto \
  -f runner=arc-runners-arch
```

`runner` selects where the job runs. `arc-runners-arch` (default) is the self-hosted ARC runner on golyat-4. `ubuntu-22.04` is the GitHub-hosted path that produced the 2026-06 golyat-4 images; it installs `libguestfs-tools`/`qemu-utils` itself and is kept as an explicit fallback for when the self-hosted runner cannot take jobs. On 2026-10-22 the self-hosted runner (pinned `actions-runner` 2.335.1) was rejected by GitHub's minimum runner version policy, so the BOXP-269 builds for golyat-1/2/3 were made with `runner=ubuntu-22.04`; the runner image bump is tracked in arch #13812.

Or build locally when `qemu-img`, `virt-resize`, `virt-customize`, `virt-sysprep`, `virt-copy-out`, and `xz` are available:

```bash
NODE_NAME=golyat-1 \
BASE_RELEASE=noble \
IMAGE_SIZE=16G \
OUTPUT_DIR=/tmp/gpu-worker-image-prod \
scripts/images/build-gpu-worker-image.sh
```

`INSTALL_GPU_HOST_TOOLS` and `WORKER_NETWORK_INTERFACE` default to `auto` (resolved from `ansible/vars/worker_nodes.yml`); set them explicitly only for experiments. `scripts/images/worker-node-config.py <node>` prints the resolved values.

After `virt-sysprep` the build runs `scripts/images/verify-gpu-worker-image.sh --image <qcow2>`, which copies `/etc`, `/home`, `/root`, `/opt`, `/usr/local/sbin`, and the dpkg status out of the image (read-only) and checks hostname, `/etc/lolice-worker-image`, the systemd-networkd static address and interface, kubelet `--node-ip`, kubelet/kubeadm/kubectl/cri-o package versions, GPU packages present or absent as expected, sshd password login disabled, no baked SSH host keys, the `boxp` authorized keys, no kubeadm join material, no build residue, and no credential patterns. The report is stored next to the image (`image-verify.txt` / `latest.verify.txt` in S3) and summarized in `image-info.json`.

After the upload, `scripts/images/verify-gpu-worker-image-s3.sh` reads the bucket back independently (read-only): every artifact and `latest` object must exist, both image objects must have the local size and, when streamed back and hashed, the local sha256, the stored `.sha256` files must carry that digest, the artifact tags (node name, commit) are checked when the role can read them (the current build role lacks `s3:GetObjectTagging`, which is reported as a warning), and no other node's `images/<node>/latest.img.xz` may have changed during the run unless that node's own `image-info.json` shows a concurrent build of that node (reported as a warning). The resulting table (key / size / last modified / etag) is written to the job summary so the S3 object handles are recorded with the run. The Longhorn multipath blacklist (`/etc/multipath/conf.d/90-longhorn.conf`, BOXP-267) is required as soon as `ansible/files/longhorn-multipath.conf` exists in the repository and only reported as a warning before that.

The stable latest image is uploaded to:

```text
s3://arch-gpu-worker-images/images/<node_name>/
```

Timestamped artifacts are uploaded to:

```text
s3://arch-gpu-worker-images/images/artifacts/<node_name>/
```

Timestamped S3 objects under the `artifacts/` prefix expire after 30 days. `latest.img.xz`, `latest.img.xz.sha256`, and `image-info.json` under the stable node prefix are overwritten on each successful build and are not current-object expiration targets. Noncurrent versions are retained for 30 days by the bucket lifecycle policy.

The workflow intentionally does not upload the image to GitHub Actions artifacts. The customized image can include node access material and must stay in the private S3 image bucket, matching the Orange Pi image workflow storage model.

The image is built at the requested `image_size`, currently `16G`, and includes `lolice-grow-rootfs.service`. On first boot, that service runs `growpart` against the mounted root partition and resizes the root filesystem so the flashed image can use the full target disk. The compressed artifact is a full disk image, not an installer.

The Phase 2 local artifact verified on 2026-06-27 was:

```text
/tmp/gpu-worker-image-prod/ubuntu-jammy-amd64-gpu-worker-golyat-4-20260627-044908-5782c8b6.img.xz
sha256: f0471fce28b52dff8c677bad07630f6cf33c64f92009781b85746f8b2076843c
```

The local artifact passed `sha256sum -c` and `xz --test`. Treat `/tmp` artifacts as ephemeral; rerun the workflow for durable S3 storage.

## Image Contents

The image is based on the current Ubuntu 24.04 Noble amd64 cloud image, then customized with Ansible:

- `boxp` user with GitHub SSH keys
- SSH enabled with password login disabled
- Kubernetes `kubelet`, `kubeadm`, `kubectl` pinned to `1.36.1-1.1`
- CRI-O pinned to package version `1.36.1-1.1`
- Intel graphics PPA `ppa:kobuk-team/intel-graphics`
- Intel OpenCL / Level Zero runtime packages: `intel-opencl-icd`, `libze-intel-gpu1`, `libze1`, `intel-gsc`, `intel-ocloc`, `libze-dev`
- Host smoke-test tools: `clinfo`, `intel-gpu-tools`, `vainfo`
- Kubernetes sysctl/module baseline for workers
- `/etc/lolice-worker-image` build metadata

The image identity (hostname / Kubernetes node name, static IP, interface) is the `node_name` passed to the build and its entry in `ansible/vars/worker_nodes.yml`.

Intel device plugin, node labels, taints, and cluster join are intentionally left to later phases. GPU runtime packages are installed only for nodes with `gpu_host_tools: true` (golyat-4) so its first boot can verify `/dev/dri` and `clinfo -l` before joining the cluster; the golyat-1..3 images do not carry the Intel graphics PPA or packages.

## Pre-Flash Gate

Do not write this image to the GMKtec internal storage until all checks are true:

- Windows backup log for BOXP-23 is complete.
- Recovery USB or equivalent boot media is available.
- The target disk has been identified from a live Linux environment with `lsblk -o NAME,SIZE,MODEL,SERIAL,TYPE,MOUNTPOINTS`.
- The backup destination disk and boot USB are not the selected target.
- The image checksum has been verified locally.

## Download And Verify

```bash
node=golyat-4
aws s3 cp "s3://arch-gpu-worker-images/images/${node}/latest.img.xz" ./
aws s3 cp "s3://arch-gpu-worker-images/images/${node}/latest.img.xz.sha256" ./
aws s3 cp "s3://arch-gpu-worker-images/images/${node}/image-info.json" ./
sha256sum -c latest.img.xz.sha256
jq '{node_name, node_ip, network_interface, gpu_host_tools, kubernetes_package_version, crio_package_version, longhorn_multipath_blacklist, verification}' image-info.json
```

If using the unique timestamped image instead of `latest.img.xz`, verify the matching timestamped checksum file. Confirm `node_name` in `image-info.json` is the node you are about to flash before writing anything.

## USB Boot Smoke Test

The image can be written to a USB drive for a direct boot smoke test. In that mode, the USB drive itself is the root disk; the image does not install itself to the internal SSD/NVMe.

Replace `/dev/sdX` only after confirming it is the intended USB drive.

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,TYPE,MOUNTPOINTS
xzcat ubuntu-noble-amd64-gpu-worker-golyat-4-*.img.xz | sudo dd of=/dev/sdX bs=16M status=progress conv=fsync
sync
```

## Flash From Generic Live USB

Replace `/dev/nvmeXn1` only after confirming it is the intended target.

```bash
lsblk -o NAME,SIZE,MODEL,SERIAL,TYPE,MOUNTPOINTS
sudo wipefs --no-act /dev/nvmeXn1
xzcat ubuntu-noble-amd64-gpu-worker-golyat-4-*.img.xz | sudo dd of=/dev/nvmeXn1 bs=16M status=progress conv=fsync
sync
sudo partprobe /dev/nvmeXn1
```

The target is the whole disk, not an existing partition. Existing EFI, Windows, recovery, and data partitions on the target disk are overwritten by this operation.

First boot should reach SSH with the baked `boxp` account. Cluster join is performed later with `kubeadm join`.

After first boot, confirm root filesystem expansion:

```bash
systemctl status lolice-grow-rootfs.service --no-pager
cat /var/log/lolice-grow-rootfs.log
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
df -h /
ls -l /dev/dri
clinfo -l
```

## Rollback And Recovery

Rollback options, in order:

1. Boot the recovery USB and inspect the disk without modifying it.
2. Re-flash the previous known-good worker image if available.
3. Restore the Windows backup created before Phase 3.
4. If the node partially joined the cluster, remove it with `kubectl drain`, `kubectl delete node`, and `kubeadm reset` from the host before reattempting.

Stop the Phase 3 flash if any of these are true:

- Target disk identity is ambiguous.
- Checksum verification fails.
- Windows backup is incomplete.
- The live environment cannot see the intended target disk and backup disk distinctly.
