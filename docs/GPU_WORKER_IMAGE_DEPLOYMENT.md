# GPU Worker Image Deployment

This document covers the Phase 2 GPU worker image artifact, flash procedure, and recovery gates for BOXP-23. It defines the procedure only; writing the GMKtec EVO-T1 internal NVMe is a Phase 3 destructive operation.

## Build

Run the workflow manually:

```bash
gh workflow run build-gpu-worker-image.yml \
  -f node_name=golyat-4 \
  -f base_release=noble \
  -f image_size=16G \
  -f install_gpu_host_tools=true
```

Or build locally when `qemu-img`, `virt-resize`, `virt-customize`, `virt-sysprep`, and `xz` are available:

```bash
NODE_NAME=golyat-4 \
BASE_RELEASE=noble \
IMAGE_SIZE=16G \
OUTPUT_DIR=/tmp/gpu-worker-image-prod \
INSTALL_GPU_HOST_TOOLS=true \
scripts/images/build-gpu-worker-image.sh
```

The stable latest image is uploaded to:

```text
s3://arch-gpu-worker-images/images/golyat-4/
```

Timestamped artifacts are uploaded to:

```text
s3://arch-gpu-worker-images/images/artifacts/golyat-4/
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

The initial GPU worker identity is:

- hostname / Kubernetes node name: `golyat-4`
- planned static IP: `192.168.10.107`

Intel device plugin, node labels, taints, and cluster join are intentionally left to later phases. GPU runtime packages are installed by default so first boot can verify `/dev/dri` and `clinfo -l` before joining the cluster.

## Pre-Flash Gate

Do not write this image to the GMKtec internal storage until all checks are true:

- Windows backup log for BOXP-23 is complete.
- Recovery USB or equivalent boot media is available.
- The target disk has been identified from a live Linux environment with `lsblk -o NAME,SIZE,MODEL,SERIAL,TYPE,MOUNTPOINTS`.
- The backup destination disk and boot USB are not the selected target.
- The image checksum has been verified locally.

## Download And Verify

```bash
aws s3 cp s3://arch-gpu-worker-images/images/golyat-4/latest.img.xz ./
aws s3 cp s3://arch-gpu-worker-images/images/golyat-4/latest.img.xz.sha256 ./
sha256sum -c latest.img.xz.sha256
```

If using the unique timestamped image instead of `latest.img.xz`, verify the matching timestamped checksum file.

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
