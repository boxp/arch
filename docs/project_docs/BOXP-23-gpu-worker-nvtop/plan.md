# BOXP-23: GPU worker nvtop image tool

## Goal

Include the `nvtop` package from `ppa:quentiumyt/nvtop` in the GPU worker image so `golyat-4` has an interactive Intel GPU monitoring tool available immediately after image boot.

## Plan

1. Add a `gpu_worker_host_tools` Ansible role for GPU worker host/image smoke and operations tools.
2. Move existing optional GPU host packages from `ansible/playbooks/worker-image.yml` into that role.
3. Add `ppa:quentiumyt/nvtop` and install `nvtop` alongside `clinfo`, `intel-gpu-tools`, and `vainfo` when `worker_install_gpu_host_tools` is enabled.
4. Make the GPU worker image build include host tools by default while keeping the existing build action switch available for explicit opt-out.

## Validation

- Parse the worker image playbook as YAML.
- Run `ansible-playbook --syntax-check` for `ansible/playbooks/worker-image.yml`.
- Run `bash -n scripts/images/build-gpu-worker-image.sh`.
- Run `actionlint` for `.github/workflows/build-gpu-worker-image.yml`.
