#!/usr/bin/env bash
set -euo pipefail

NODE_NAME="${NODE_NAME:-golyat-4}"
BASE_RELEASE="${BASE_RELEASE:-jammy}"
IMAGE_SIZE="${IMAGE_SIZE:-16G}"
OUTPUT_DIR="${OUTPUT_DIR:-build/gpu-worker-image}"
INSTALL_GPU_HOST_TOOLS="${INSTALL_GPU_HOST_TOOLS:-false}"
CONFIGURE_STATIC_NETWORK="${CONFIGURE_STATIC_NETWORK:-true}"
WORKER_NETWORK_INTERFACE="${WORKER_NETWORK_INTERFACE:-enp44s0}"
GUESTFS_MEMSIZE="${GUESTFS_MEMSIZE:-4096}"
GUESTFS_SMP="${GUESTFS_SMP:-2}"

case "$BASE_RELEASE" in
  jammy|noble) ;;
  *)
    echo "unsupported BASE_RELEASE: $BASE_RELEASE" >&2
    exit 2
    ;;
esac

if [[ ! "$NODE_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "NODE_NAME must contain only letters, numbers, dot, underscore, or hyphen: $NODE_NAME" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "$OUTPUT_DIR" = /* ]]; then
  work_dir="$OUTPUT_DIR"
else
  work_dir="$repo_root/$OUTPUT_DIR"
fi
cache_dir="$work_dir/cache"
mkdir -p "$cache_dir"

base_url="https://cloud-images.ubuntu.com/${BASE_RELEASE}/current"
base_image="${BASE_RELEASE}-server-cloudimg-amd64.img"
base_sha_file="SHA256SUMS"

echo "Downloading Ubuntu cloud image metadata for ${BASE_RELEASE}"
curl -fsSL "$base_url/$base_sha_file" -o "$cache_dir/$base_sha_file"

download_base_image() {
  echo "Downloading $base_image"
  curl -fL "$base_url/$base_image" -o "$cache_dir/$base_image"
}

verify_base_image() {
  (
    cd "$cache_dir"
    grep -E "[ *]${base_image}\$" "$base_sha_file" | sha256sum -c -
  )
}

if [ ! -f "$cache_dir/$base_image" ]; then
  download_base_image
elif ! verify_base_image; then
  echo "Cached $base_image does not match current checksum; refreshing"
  rm -f "$cache_dir/$base_image"
  download_base_image
fi

verify_base_image

timestamp="$(date -u +%Y%m%d-%H%M%S)"
git_sha="$(git -C "$repo_root" rev-parse --short=8 HEAD)"
image_basename="ubuntu-${BASE_RELEASE}-amd64-gpu-worker-${NODE_NAME}-${timestamp}-${git_sha}"
qcow_image="$work_dir/${image_basename}.qcow2"
raw_image="$work_dir/${image_basename}.img"
compressed_image="$raw_image.xz"

export LIBGUESTFS_BACKEND="${LIBGUESTFS_BACKEND:-direct}"

rm -f "$qcow_image" "$raw_image" "$compressed_image" "$compressed_image.sha256"
qemu-img create -f qcow2 "$qcow_image" "$IMAGE_SIZE"
virt-resize --expand /dev/sda1 "$cache_dir/$base_image" "$qcow_image"

virt-customize \
  --memsize "$GUESTFS_MEMSIZE" \
  --smp "$GUESTFS_SMP" \
  -a "$qcow_image" \
  --hostname "$NODE_NAME" \
  --mkdir /opt/arch-ansible \
  --copy-in "$repo_root/ansible:/opt/arch-ansible" \
  --run-command "apt-get update" \
  --run-command "DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg python3-apt python3-pip python3-venv sudo" \
  --run-command "python3 -m venv /opt/ansible-venv" \
  --run-command "/opt/ansible-venv/bin/python -m pip install --no-cache-dir ansible==9.13.0" \
  --run-command "LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH=/opt/ansible-venv/bin:\$PATH ansible-galaxy collection install -r /opt/arch-ansible/ansible/requirements.yml" \
  --run-command "cd /opt/arch-ansible/ansible && LANG=C.UTF-8 LC_ALL=C.UTF-8 PATH=/opt/ansible-venv/bin:\$PATH ansible-playbook -i inventories/image-build/hosts.ini playbooks/worker-image.yml -e node_name=${NODE_NAME} -e worker_install_gpu_host_tools=${INSTALL_GPU_HOST_TOOLS} -e worker_configure_static_network=${CONFIGURE_STATIC_NETWORK} -e worker_static_network_interface=${WORKER_NETWORK_INTERFACE} -e chroot_build=true" \
  --run-command "apt-get clean" \
  --run-command "rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /opt/arch-ansible /opt/ansible-venv"

virt-sysprep -a "$qcow_image" \
  --operations machine-id,ssh-hostkeys,udev-persistent-net,logfiles,tmp-files,bash-history,customize \
  --hostname "$NODE_NAME"

qemu-img convert -O raw "$qcow_image" "$raw_image"
xz -T0 -f "$raw_image"
(
  cd "$(dirname "$compressed_image")"
  sha256sum "$(basename "$compressed_image")" > "$(basename "$compressed_image").sha256"
)

cat > "$work_dir/image-info.json" <<EOF
{
  "node_name": "$NODE_NAME",
  "base_release": "$BASE_RELEASE",
  "image_size": "$IMAGE_SIZE",
  "image_file": "$(basename "$compressed_image")",
  "checksum_file": "$(basename "$compressed_image").sha256",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_method": "ubuntu-cloud-image/libguestfs/ansible-worker-image",
  "github_sha": "$(git -C "$repo_root" rev-parse HEAD)"
}
EOF

echo "FINAL_IMAGE=$compressed_image"
echo "CHECKSUM_FILE=$compressed_image.sha256"
echo "IMAGE_INFO=$work_dir/image-info.json"
