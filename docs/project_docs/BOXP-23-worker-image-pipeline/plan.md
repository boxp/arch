# BOXP-23: GPU worker image pipeline

## Goal

Complete Phase 2 of the lolice GPU worker local LLM project by adding a reproducible amd64 worker image build pipeline to `boxp/arch`.

## Scope

- Add a worker image Ansible playbook that installs user/SSH, pinned Kubernetes and CRI-O packages, and worker baseline configuration.
- Set the initial GPU worker identity to `golyat-4` / `192.168.10.107`.
- Build the image from an Ubuntu amd64 cloud image with `qemu-img` and `libguestfs`.
- Produce compressed image, checksum, and metadata artifacts.
- Upload stable latest image objects and timestamped artifacts under the existing image S3 bucket using new GPU worker prefixes.
- Document flash, checksum, rollback, and recovery gates.

## Non-Goals

- Do not write to the GMKtec internal NVMe in Phase 2.
- Do not join the node to the Kubernetes cluster in Phase 2.
- Do not install Intel Kubernetes device plugin, workload manifests, labels, taints, or local LLM runtime in Phase 2.

## Implementation

1. Add `ansible/playbooks/worker-image.yml` for amd64 worker image customization.
2. Add `scripts/images/build-gpu-worker-image.sh` to build from Ubuntu cloud images, expand the root filesystem with `virt-resize`, install a pinned Ansible in a guest venv, run the Ansible playbook, sysprep, compress, and checksum.
3. Add `.github/workflows/build-gpu-worker-image.yml` for manual image builds and artifact upload.
4. Extend the image S3 IAM policy to allow `images/ubuntu-amd64-gpu-worker/*`.
5. Add `docs/GPU_WORKER_IMAGE_DEPLOYMENT.md` with build, verify, flash, and recovery procedure.
6. Keep Plan Ansible resilient to a temporarily unreachable live node by warning and skipping that node's plan after SSH preflight failure, while still running plans for reachable nodes.

## Artifact Retention

- Stable latest objects: `images/ubuntu-amd64-gpu-worker/{node}/latest.img.xz`, matching `.sha256`, and `image-info.json`.
- Timestamped artifacts: `images/ubuntu-amd64-gpu-worker/artifacts/{node}/`.
- Current timestamped artifacts expire after 30 days. Stable latest objects do not have current-object expiration.

## Verification

Completed:

- `bash -n scripts/images/build-gpu-worker-image.sh`
- `git diff --check`
- `ansible-playbook -i inventories/image-build/hosts.ini playbooks/worker-image.yml --syntax-check -e node_name=golyat-4 -e chroot_build=true`
- Local 16G smoke build in `/tmp/gpu-worker-image-smoke`
- Local 64G production build in `/tmp/gpu-worker-image-prod`
- `sha256sum -c /tmp/gpu-worker-image-prod/ubuntu-jammy-amd64-gpu-worker-golyat-4-20260627-044908-5782c8b6.img.xz.sha256`
- `xz --test /tmp/gpu-worker-image-prod/ubuntu-jammy-amd64-gpu-worker-golyat-4-20260627-044908-5782c8b6.img.xz`

Pending outside this workspace:

- `terraform fmt -check terraform/aws/orange-pi-images` still requires Terraform or OpenTofu in the runner.
- S3 upload is expected to run in GitHub Actions after PR review.
