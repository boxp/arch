#!/usr/bin/env bash
set -euo pipefail

NODE_NAME="${NODE_NAME:-golyat-4}"
BASE_RELEASE="${BASE_RELEASE:-noble}"
IMAGE_SIZE="${IMAGE_SIZE:-16G}"
OUTPUT_DIR="${OUTPUT_DIR:-build/gpu-worker-image}"
# BOXP-269: "auto" resolves the GPU host tools decision and the network
# interface from ansible/vars/worker_nodes.yml for NODE_NAME. Explicit values are
# still honoured for one-off experiments.
INSTALL_GPU_HOST_TOOLS="${INSTALL_GPU_HOST_TOOLS:-auto}"
CONFIGURE_STATIC_NETWORK="${CONFIGURE_STATIC_NETWORK:-true}"
WORKER_NETWORK_INTERFACE="${WORKER_NETWORK_INTERFACE:-auto}"
VERIFY_IMAGE="${VERIFY_IMAGE:-true}"
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

case "$INSTALL_GPU_HOST_TOOLS" in
  auto|true|false) ;;
  *)
    echo "INSTALL_GPU_HOST_TOOLS must be auto, true, or false: $INSTALL_GPU_HOST_TOOLS" >&2
    exit 2
    ;;
esac

case "$CONFIGURE_STATIC_NETWORK" in
  true|false) ;;
  *)
    echo "CONFIGURE_STATIC_NETWORK must be true or false: $CONFIGURE_STATIC_NETWORK" >&2
    exit 2
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script_dir="$repo_root/scripts/images"
if [[ "$OUTPUT_DIR" = /* ]]; then
  work_dir="$OUTPUT_DIR"
else
  work_dir="$repo_root/$OUTPUT_DIR"
fi
cache_dir="$work_dir/cache"
mkdir -p "$cache_dir"

# Resolve the node's expectations (IP, NIC, GPU tools, pinned versions) from
# the same files the playbook reads. PyYAML is the only dependency; fall back
# to a throwaway venv when the host python lacks it.
node_config_python=python3
if ! python3 -c 'import yaml' 2>/dev/null; then
  python3 -m venv "$work_dir/tools-venv"
  "$work_dir/tools-venv/bin/python" -m pip install --quiet --no-cache-dir 'pyyaml>=6'
  node_config_python="$work_dir/tools-venv/bin/python"
fi
node_config="$("$node_config_python" "$script_dir/worker-node-config.py" "$NODE_NAME" --repo-root "$repo_root")"
echo "$node_config"
expected_node_ip="$(grep '^NODE_IP=' <<< "$node_config" | cut -d= -f2-)"
expected_interface="$(grep '^NETWORK_INTERFACE=' <<< "$node_config" | cut -d= -f2-)"
expected_gpu_host_tools="$(grep '^GPU_HOST_TOOLS=' <<< "$node_config" | cut -d= -f2-)"
expected_gateway="$(grep '^GATEWAY=' <<< "$node_config" | cut -d= -f2-)"
expected_k8s_package="$(grep '^KUBERNETES_PACKAGE_VERSION=' <<< "$node_config" | cut -d= -f2-)"
expected_k8s_version="$(grep '^KUBERNETES_VERSION=' <<< "$node_config" | cut -d= -f2-)"
expected_crio_package="$(grep '^CRIO_PACKAGE_VERSION=' <<< "$node_config" | cut -d= -f2-)"
expected_crio_version="$(grep '^CRIO_VERSION=' <<< "$node_config" | cut -d= -f2-)"

if [ "$INSTALL_GPU_HOST_TOOLS" = auto ]; then
  INSTALL_GPU_HOST_TOOLS="$expected_gpu_host_tools"
fi
if [ "$WORKER_NETWORK_INTERFACE" = auto ]; then
  WORKER_NETWORK_INTERFACE="$expected_interface"
fi
if [[ ! "$WORKER_NETWORK_INTERFACE" =~ ^[a-z][a-z0-9]*$ ]]; then
  echo "WORKER_NETWORK_INTERFACE must be a plain interface name: $WORKER_NETWORK_INTERFACE" >&2
  exit 2
fi
# The Longhorn multipath blacklist (BOXP-267) is required in the image as soon
# as the repository ships it; before that the verifier only warns.
if [ -f "$repo_root/ansible/files/longhorn-multipath.conf" ]; then
  require_longhorn_multipath=true
else
  require_longhorn_multipath=false
fi
echo "Resolved build parameters: node=$NODE_NAME ip=$expected_node_ip interface=$WORKER_NETWORK_INTERFACE gpu_host_tools=$INSTALL_GPU_HOST_TOOLS static_network=$CONFIGURE_STATIC_NETWORK longhorn_multipath_required=$require_longhorn_multipath"

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

# The "customize" operation re-generates /etc/machine-id (and would re-set the
# hostname already set by virt-customize above), so it is left out; the image
# must ship with an empty machine-id so each flash gets a fresh one.
virt-sysprep -a "$qcow_image" \
  --operations machine-id,ssh-hostkeys,udev-persistent-net,logfiles,tmp-files,bash-history

# Verify the finished (sysprepped) root tree before compressing. The verifier
# reads the image with virt-copy-out and never modifies it.
verify_report="$work_dir/image-verify.txt"
rm -f "$verify_report"
verification_status="skipped"
if [ "$VERIFY_IMAGE" = true ]; then
  "$script_dir/verify-gpu-worker-image.sh" \
    --image "$qcow_image" \
    --node "$NODE_NAME" \
    --node-ip "$expected_node_ip" \
    --interface "$WORKER_NETWORK_INTERFACE" \
    --gpu-host-tools "$INSTALL_GPU_HOST_TOOLS" \
    --gateway "$expected_gateway" \
    --static-network "$CONFIGURE_STATIC_NETWORK" \
    --kubernetes-package-version "$expected_k8s_package" \
    --crio-package-version "$expected_crio_package" \
    --require-longhorn-multipath "$require_longhorn_multipath" \
    --report "$verify_report"
  verification_status="passed"
fi
if grep -q '^ok: multipath: Longhorn blacklist baked' "$verify_report" 2>/dev/null; then
  longhorn_multipath_blacklist=true
else
  longhorn_multipath_blacklist=false
fi

qemu-img convert -O raw "$qcow_image" "$raw_image"
xz -T0 -f "$raw_image"
(
  cd "$(dirname "$compressed_image")"
  sha256sum "$(basename "$compressed_image")" > "$(basename "$compressed_image").sha256"
)

cat > "$work_dir/image-info.json" <<EOF
{
  "node_name": "$NODE_NAME",
  "node_ip": "$expected_node_ip",
  "network_interface": "$WORKER_NETWORK_INTERFACE",
  "static_network": $CONFIGURE_STATIC_NETWORK,
  "gpu_host_tools": $INSTALL_GPU_HOST_TOOLS,
  "kubernetes_version": "$expected_k8s_version",
  "kubernetes_package_version": "$expected_k8s_package",
  "crio_version": "$expected_crio_version",
  "crio_package_version": "$expected_crio_package",
  "longhorn_multipath_blacklist": $longhorn_multipath_blacklist,
  "base_release": "$BASE_RELEASE",
  "image_size": "$IMAGE_SIZE",
  "image_file": "$(basename "$compressed_image")",
  "checksum_file": "$(basename "$compressed_image").sha256",
  "verification": "$verification_status",
  "verification_report": "$(basename "$verify_report")",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_method": "ubuntu-cloud-image/libguestfs/ansible-worker-image",
  "github_sha": "$(git -C "$repo_root" rev-parse HEAD)"
}
EOF

echo "FINAL_IMAGE=$compressed_image"
echo "CHECKSUM_FILE=$compressed_image.sha256"
echo "IMAGE_INFO=$work_dir/image-info.json"
echo "VERIFY_REPORT=$verify_report"
