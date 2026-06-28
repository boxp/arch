# BOXP-23 GPU worker Noble runtime image

## Goal

Move the GPU worker image pipeline to the runtime that worked on the real `golyat-4` hardware: Ubuntu 24.04 Noble plus Intel graphics PPA runtime packages.

## Context

The first 16GiB worker image was based on Ubuntu 22.04 Jammy. It booted and joined after first-boot fixes, but Arc 140T did not expose `/dev/dri` on the 5.15 kernel. In-place upgrade to Ubuntu 24.04 with Intel graphics runtime packages made the hardware usable:

- `/dev/dri/card0`
- `/dev/dri/renderD128`
- `clinfo -l` -> `Intel(R) Arc(TM) Graphics`

## Change

- Default `build-gpu-worker-image.yml` `base_release` to `noble`.
- Default `install_gpu_host_tools` to `true`.
- Default `scripts/images/build-gpu-worker-image.sh` `BASE_RELEASE` to `noble`.
- Install Intel graphics PPA and OpenCL / Level Zero runtime packages when GPU runtime tools are enabled.
- Update GPU worker deployment docs to use Noble paths and first-boot GPU checks.
- Leave Kubernetes workload image tag/digest updates to the repository's existing Argo CD Image Updater flow.

## Validation

- `bash -n scripts/images/build-gpu-worker-image.sh`
- parse workflow YAML
- parse Ansible playbook YAML

Post-merge validation:

- dispatch `Build GPU Worker Image` on main with default inputs
- verify S3 `latest.img.xz`, checksum, and `image-info.json`
- flash `golyat-4` near the end of Phase 7
- verify `/dev/dri/card0`, `/dev/dri/renderD128`, and `clinfo -l`
