# BOXP-23: GPU worker image size 16G

## Goal

Make the GPU worker disk image small enough to write to common removable media and smaller SSDs while preserving first-boot root filesystem expansion on the final target disk.

## Scope

1. Change the GPU worker image builder default `IMAGE_SIZE` from `64G` to `16G`.
2. Change the manual GitHub Actions workflow default `image_size` from `64G` to `16G`.
3. Update deployment documentation to describe the image as a full disk image, not an installer.
4. Document USB boot smoke testing by writing the image directly to a USB drive.
5. Document the generic live USB flow for writing the image to the internal SSD/NVMe.

## Notes

- The existing S3 `latest.img.xz` was built as a 64G raw disk image and still requires a target disk at least that large.
- A new workflow run is required after this change is merged to publish a 16G `latest.img.xz`.
- The image already includes `lolice-grow-rootfs.service`; after boot from the final target disk, it grows the root partition and filesystem to fill the disk.
- Existing EFI, Windows, recovery, and data partitions on the target disk are overwritten when the image is written to the whole disk.

## Verification

- Run `bash -n scripts/images/build-gpu-worker-image.sh`.
- Parse `.github/workflows/build-gpu-worker-image.yml` as YAML.
- Run `actionlint .github/workflows/build-gpu-worker-image.yml`.
- Run `git diff --check`.
