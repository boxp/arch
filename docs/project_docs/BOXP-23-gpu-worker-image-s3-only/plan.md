# BOXP-23: GPU worker image S3-only artifacts

## Goal

Prevent the GPU worker image from being exposed as a GitHub Actions artifact. The image should be stored only in the private AWS S3 image bucket, matching the Orange Pi image workflow.

## Context

The GPU worker image is customized for node bootstrapping. Even if SSH host keys are regenerated later, image distribution should assume node access material can be sensitive. GitHub Actions artifacts are not the desired storage boundary for this image.

The previous `Build GPU Worker Image` run uploaded `gpu-worker-image-golyat-4` as a GitHub Actions artifact. That artifact must be deleted, and future runs must not create a replacement GitHub artifact.

## Scope

1. Remove the `Upload GitHub artifact` step from `.github/workflows/build-gpu-worker-image.yml`.
2. Keep S3 upload, stable latest objects, timestamped artifacts, checksums, and metadata unchanged.
3. Update the build summary to state that artifact storage is S3-only.
4. Update `docs/GPU_WORKER_IMAGE_DEPLOYMENT.md` to document that GitHub Actions artifacts are intentionally not used for GPU worker images.
5. Delete existing GitHub Actions artifact `gpu-worker-image-golyat-4` from run `28311016611`.
6. Re-run the workflow from `main` after merge and verify that S3 upload succeeds and no GitHub artifact is created.

## Non-Goals

- Do not change the image contents.
- Do not change S3 bucket names, prefixes, retention, or IAM policy.
- Do not write the image to the physical GPU worker.

## Verification

- Parse `.github/workflows/build-gpu-worker-image.yml` as YAML.
- Run `actionlint .github/workflows/build-gpu-worker-image.yml`.
- Run `git diff --check`.
- Confirm no `actions/upload-artifact` reference remains in the GPU worker image workflow.
- Confirm artifact ID `7931086983` is deleted.
- Confirm a post-merge `Build GPU Worker Image` run succeeds with no GitHub Actions artifacts.
