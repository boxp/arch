# BOXP-23: GPU worker image workflow fix

## Goal

Unblock the durable Phase 2 GPU worker image artifact build from `boxp/arch` main branch.

## Context

The first main-branch `Build GPU Worker Image` dispatch after BOXP-23 merge failed before S3 and GitHub artifact upload.

- Run: `28310875665`
- Ref: `main`
- SHA: `d10efc324e5f2d54cd050bf4967e0b1a4bc68b00`
- Failure: `virt-customize: error: libguestfs error: passt exited with status 1`
- Workflow issue: the build step piped the script through `tee` without `pipefail`, so the step reported success and the following verify step received empty output paths.

## Scope

1. Pin the image build workflow to `ubuntu-22.04` instead of `ubuntu-latest` so libguestfs behavior does not change under the workflow.
2. Make `/dev/kvm` usable on GitHub-hosted runners when present.
3. Add `set -o pipefail` to the build step so script failures stop the job at the failing step.
4. Validate that the image, checksum, and metadata files exist before writing step outputs.

## Non-Goals

- Do not change the generated image contents.
- Do not alter S3 prefixes, retention, IAM policy, or artifact naming.
- Do not write the image to the physical GPU worker in this fix.

## Verification

Local checks:

- Parse `.github/workflows/build-gpu-worker-image.yml` as YAML.
- `git diff --check`

Remote checks after merge:

- Dispatch `Build GPU Worker Image` from `main`.
- Confirm `Verify image artifact`, `Upload image to S3`, and `Upload GitHub artifact` pass.
- Record final image name, checksum, S3 stable path, S3 artifact prefix, and GitHub run URL in the Obsidian project log.
