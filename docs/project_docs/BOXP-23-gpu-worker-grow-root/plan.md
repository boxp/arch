# BOXP-23: GPU worker root filesystem growth

## Goal

Ensure the GPU worker image expands its root partition and filesystem to fill the target disk after it is flashed to physical storage.

## Context

The current image builder expands the Ubuntu cloud image only to the workflow input `image_size`, currently `64G`:

- `qemu-img create -f qcow2 "$qcow_image" "$IMAGE_SIZE"`
- `virt-resize --expand /dev/sda1 "$cache_dir/$base_image" "$qcow_image"`

No GPU worker image task currently installs or enables an explicit first-boot `growpart` / filesystem resize path. That means a `64G` image flashed to a larger NVMe should be expected to keep a roughly 64G root filesystem unless some implicit cloud-init behavior happens to run. The image should not depend on that implicit behavior.

## Scope

1. Install `cloud-guest-utils` and `e2fsprogs` in the worker image.
2. Add `/usr/local/sbin/lolice-grow-rootfs`.
3. Add and enable `lolice-grow-rootfs.service` as a first-boot systemd oneshot.
4. Detect the mounted root device with `findmnt`, resolve parent disk and partition number with `lsblk`, run `growpart`, then resize the mounted root filesystem.
5. Write `/var/lib/lolice-grow-rootfs.done` only after success so the service runs once.
6. Document the first-boot expansion behavior and verification commands.

## Non-Goals

- Do not change the default image build size.
- Do not change S3 artifact storage paths or retention.
- Do not write the image to the physical GPU worker.

## Verification

- `ansible-playbook -i inventories/image-build/hosts.ini playbooks/worker-image.yml --syntax-check -e node_name=golyat-4 -e chroot_build=true`
- YAML parse for `.github/workflows/build-gpu-worker-image.yml` and `ansible/playbooks/worker-image.yml`
- `git diff --check`
- Post-merge `Build GPU Worker Image` run from `main` succeeds and uploads only to S3.
