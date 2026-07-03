# BOXP-23: GPU worker S3 bucket split

## Goal

Stop storing GPU worker images in the Orange Pi image bucket. Create and use a dedicated private S3 bucket for GPU worker images.

## Scope

1. Add a new Terraform target, `terraform/aws/gpu-worker-images`, for the dedicated S3 bucket.
2. Create `arch-gpu-worker-images` and `arch-gpu-worker-images-logs`.
3. Include the target-local aqua toolchain files required by tfaction.
4. Create a dedicated GitHub Actions OIDC role, `GitHubActions_GPUWorkerImage_Build`.
5. Change GPU worker workflow uploads to `s3://arch-gpu-worker-images/images/...`.
6. Remove GPU worker permissions and lifecycle rules from the Orange Pi image bucket target.
7. Update deployment documentation to use the new S3 bucket.
8. Do not rebuild the image as part of this change.

## Non-Goals

- Do not rename or replace the existing Orange Pi S3 bucket.
- Do not change Orange Pi image paths.
- Do not write the image to the physical GPU worker.

## Migration Note

The current latest GPU worker image exists under the old prefix:

`s3://arch-orange-pi-images/images/ubuntu-amd64-gpu-worker/golyat-4/`

It can be copied to the new bucket without rebuilding after Terraform has created the bucket and IAM policy:

`s3://arch-gpu-worker-images/images/golyat-4/`

## Verification

- Parse `.github/workflows/build-gpu-worker-image.yml` as YAML.
- Run `actionlint .github/workflows/build-gpu-worker-image.yml`.
- Run `terraform fmt -check terraform/aws/orange-pi-images terraform/aws/gpu-worker-images`.
- Run `terraform -chdir=terraform/aws/gpu-worker-images init -backend=false`.
- Run `terraform -chdir=terraform/aws/gpu-worker-images validate`.
- Run `git diff --check`.
