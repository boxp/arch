#!/usr/bin/env bash
# Verify the contents of a built lolice worker image against the per-node
# expectations from ansible/vars/worker_nodes.yml (BOXP-269).
#
# Two input modes:
#   --image FILE  read a qcow2/raw image with virt-copy-out (libguestfs) and
#                 verify the extracted subset
#   --root DIR    verify an already extracted / mounted root tree (used by the
#                 unit tests; no libguestfs needed)
#
# The script never writes to the image. It prints one "ok:" / "warn:" /
# "FAIL:" line per check, writes the same lines to --report when given, and
# exits non-zero when any check failed.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: verify-gpu-worker-image.sh (--image FILE | --root DIR) --node NAME --node-ip IP
         --interface IF --gpu-host-tools true|false
         --kubernetes-package-version VER --crio-package-version VER
         [--gateway IP] [--static-network true|false]
         [--require-longhorn-multipath true|false] [--report FILE]
EOF
  exit 2
}

IMAGE=""
ROOT=""
NODE_NAME=""
NODE_IP=""
INTERFACE=""
GPU_HOST_TOOLS=""
K8S_PKG=""
CRIO_PKG=""
GATEWAY="192.168.10.1"
STATIC_NETWORK="true"
REQUIRE_LONGHORN_MULTIPATH="false"
REPORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --root) ROOT="$2"; shift 2 ;;
    --node) NODE_NAME="$2"; shift 2 ;;
    --node-ip) NODE_IP="$2"; shift 2 ;;
    --interface) INTERFACE="$2"; shift 2 ;;
    --gpu-host-tools) GPU_HOST_TOOLS="$2"; shift 2 ;;
    --kubernetes-package-version) K8S_PKG="$2"; shift 2 ;;
    --crio-package-version) CRIO_PKG="$2"; shift 2 ;;
    --gateway) GATEWAY="$2"; shift 2 ;;
    --static-network) STATIC_NETWORK="$2"; shift 2 ;;
    --require-longhorn-multipath) REQUIRE_LONGHORN_MULTIPATH="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$IMAGE" ] || [ -n "$ROOT" ] || usage
[ -z "$IMAGE" ] || [ -z "$ROOT" ] || usage
for required in NODE_NAME NODE_IP INTERFACE GPU_HOST_TOOLS K8S_PKG CRIO_PKG; do
  [ -n "${!required}" ] || { echo "missing --$(echo "$required" | tr '[:upper:]_' '[:lower:]-')" >&2; usage; }
done
case "$GPU_HOST_TOOLS" in true|false) ;; *) echo "--gpu-host-tools must be true or false" >&2; exit 2 ;; esac
case "$STATIC_NETWORK" in true|false) ;; *) echo "--static-network must be true or false" >&2; exit 2 ;; esac
case "$REQUIRE_LONGHORN_MULTIPATH" in true|false) ;; *) echo "--require-longhorn-multipath must be true or false" >&2; exit 2 ;; esac

# Paths copied out of the image. Everything the checks below read must be here.
EXTRACT_PATHS=(/etc /home /root /opt /usr/local/sbin /var/lib/dpkg/status)

tmp_dir=""
cleanup() {
  if [ -n "$tmp_dir" ] && [ -d "$tmp_dir" ]; then
    chmod -R u+rwX "$tmp_dir" 2>/dev/null || true
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT

if [ -n "$IMAGE" ]; then
  [ -f "$IMAGE" ] || { echo "image not found: $IMAGE" >&2; exit 2; }
  command -v virt-copy-out >/dev/null || { echo "virt-copy-out (libguestfs-tools) is required for --image" >&2; exit 2; }
  tmp_dir="$(mktemp -d)"
  ROOT="$tmp_dir/root"
  export LIBGUESTFS_BACKEND="${LIBGUESTFS_BACKEND:-direct}"
  echo "Extracting ${EXTRACT_PATHS[*]} from $IMAGE (read-only)"
  for path in "${EXTRACT_PATHS[@]}"; do
    mkdir -p "$ROOT$(dirname "$path")"
    virt-copy-out -a "$IMAGE" "$path" "$ROOT$(dirname "$path")"
  done
fi

[ -d "$ROOT" ] || { echo "root tree not found: $ROOT" >&2; exit 2; }
ROOT="${ROOT%/}"

failures=0
warnings=0
report_lines=()

record() {
  local line="$1"
  echo "$line"
  report_lines+=("$line")
}
ok() { record "ok: $*"; }
warn() { warnings=$((warnings + 1)); record "warn: $*"; }
fail() { failures=$((failures + 1)); record "FAIL: $*"; }

check_file_contains() {
  # check_file_contains <label> <relative path> <grep -E pattern>
  local label="$1" rel="$2" pattern="$3" file="$ROOT/$2"
  if [ ! -f "$file" ]; then
    fail "$label: $rel missing"
  elif grep -qE -- "$pattern" "$file"; then
    ok "$label: $rel matches '$pattern'"
  else
    fail "$label: $rel does not match '$pattern'"
  fi
}

check_absent() {
  local label="$1" rel="$2"
  if [ -e "$ROOT/$rel" ] || [ -L "$ROOT/$rel" ]; then
    fail "$label: $rel must not exist"
  else
    ok "$label: $rel absent"
  fi
}

check_present() {
  local label="$1" rel="$2"
  if [ -e "$ROOT/$rel" ] || [ -L "$ROOT/$rel" ]; then
    ok "$label: $rel present"
  else
    fail "$label: $rel missing"
  fi
}

dpkg_version() {
  # dpkg_version <package>  -> installed version or empty
  awk -v pkg="$1" '
    $1 == "Package:" { current = $2; installed = 0; version = "" }
    # "install ok installed" or "hold ok installed" (kubelet/kubeadm/kubectl/cri-o are held)
    $1 == "Status:" && current == pkg && $0 ~ /ok installed/ { installed = 1 }
    $1 == "Version:" && current == pkg { version = $2 }
    $0 == "" && current == pkg && installed { print version; exit }
  ' "$ROOT/var/lib/dpkg/status" 2>/dev/null || true
}

check_package_version() {
  local pkg="$1" expected="$2" actual
  actual="$(dpkg_version "$pkg")"
  if [ -z "$actual" ]; then
    fail "package: $pkg not installed"
  elif [ "$actual" = "$expected" ]; then
    ok "package: $pkg $actual"
  else
    fail "package: $pkg is $actual, expected $expected"
  fi
}

check_package_state() {
  # check_package_state <package> present|absent
  local pkg="$1" want="$2" actual
  actual="$(dpkg_version "$pkg")"
  if [ "$want" = present ] && [ -n "$actual" ]; then
    ok "package: $pkg $actual (expected present)"
  elif [ "$want" = absent ] && [ -z "$actual" ]; then
    ok "package: $pkg absent (expected absent)"
  else
    fail "package: $pkg expected $want, installed version='${actual:-}'"
  fi
}

echo "Verifying worker image tree for $NODE_NAME ($NODE_IP on $INTERFACE, gpu_host_tools=$GPU_HOST_TOOLS)"

# --- identity -----------------------------------------------------------------
check_file_contains identity etc/hostname "^${NODE_NAME}\$"
check_file_contains identity etc/lolice-worker-image "^node_name=${NODE_NAME}\$"
check_file_contains identity etc/lolice-worker-image "^kubernetes_version=${K8S_PKG%%-*}\$"
check_file_contains identity etc/lolice-worker-image "^crio_package_version=${CRIO_PKG}\$"
check_file_contains identity etc/lolice-worker-image "^static_network=$( [ "$STATIC_NETWORK" = true ] && echo True || echo False)\$"
check_file_contains identity etc/lolice-worker-image "^gpu_runtime=$( [ "$GPU_HOST_TOOLS" = true ] && echo True || echo False)\$"

# --- network ------------------------------------------------------------------
if [ "$STATIC_NETWORK" = true ]; then
  net=etc/systemd/network/20-wired.network
  check_file_contains network "$net" "^Name=${INTERFACE}\$"
  check_file_contains network "$net" "^Address=${NODE_IP}/24\$"
  check_file_contains network "$net" "^Gateway=${GATEWAY}\$"
  check_file_contains network "$net" "^DNS="
  check_present network etc/systemd/system/multi-user.target.wants/systemd-networkd.service
  if [ -f "$ROOT/$net" ]; then
    other_addresses="$(grep -E '^Address=' "$ROOT/$net" | grep -vE "^Address=${NODE_IP}/24\$" || true)"
    [ -z "$other_addresses" ] && ok "network: single static address" || fail "network: unexpected addresses: $other_addresses"
  fi
  if [ -d "$ROOT/etc/netplan" ]; then
    static_netplan="$(grep -lE "addresses|${NODE_IP}" "$ROOT"/etc/netplan/*.yaml 2>/dev/null || true)"
    [ -z "$static_netplan" ] && ok "network: no static netplan configuration" || fail "network: static netplan configuration present: $static_netplan"
  else
    ok "network: no netplan directory"
  fi
  other_networkd="$(find "$ROOT/etc/systemd/network" -maxdepth 1 -name '*.network' ! -name 20-wired.network 2>/dev/null || true)"
  [ -z "$other_networkd" ] && ok "network: 20-wired.network is the only .network unit" || warn "network: additional networkd units: $other_networkd"
else
  check_absent network etc/systemd/network/20-wired.network
fi

# --- kubernetes / cri-o -------------------------------------------------------
check_file_contains kubelet etc/systemd/system/kubelet.service.d/10-kubeadm.conf "--node-ip=${NODE_IP}( |\"|\$)"
check_present kubelet etc/kubernetes/kubelet-config.yaml
check_present kubelet etc/systemd/system/multi-user.target.wants/kubelet.service
check_present crio etc/crio/crio.conf.d/02-cgroup-manager.conf
check_present crio etc/systemd/system/multi-user.target.wants/crio.service
check_package_version kubelet "$K8S_PKG"
check_package_version kubeadm "$K8S_PKG"
check_package_version kubectl "$K8S_PKG"
check_package_version cri-o "$CRIO_PKG"
check_absent "join material" etc/kubernetes/kubelet.conf
check_absent "join material" etc/kubernetes/bootstrap-kubelet.conf
check_absent "join material" etc/kubernetes/pki
check_absent "join material" etc/kubernetes/admin.conf

# --- gpu host tools (machine specific) ---------------------------------------
if [ "$GPU_HOST_TOOLS" = true ]; then
  check_package_state intel-opencl-icd present
  check_package_state clinfo present
  check_file_contains gpu etc/lolice-worker-image "^intel_graphics_ppa=ppa:"
else
  check_package_state intel-opencl-icd absent
  check_package_state clinfo absent
  check_file_contains gpu etc/lolice-worker-image "^intel_graphics_ppa=\$"
fi
check_package_state docker-ce absent
check_package_state containerd.io absent

# --- ssh / users --------------------------------------------------------------
check_file_contains ssh etc/ssh/sshd_config "^PasswordAuthentication no\$"
check_file_contains ssh etc/ssh/sshd_config "^PermitRootLogin no\$"
check_present ssh etc/systemd/system/multi-user.target.wants/ssh.service
check_present ssh etc/systemd/system/ssh.service.wants/lolice-ssh-hostkeys.service
host_keys="$(find "$ROOT/etc/ssh" -maxdepth 1 -name 'ssh_host_*_key' 2>/dev/null || true)"
[ -z "$host_keys" ] && ok "ssh: no baked host keys (generated on first boot)" || fail "ssh: baked host keys present: $host_keys"
auth_keys=home/boxp/.ssh/authorized_keys
if [ -s "$ROOT/$auth_keys" ]; then
  if grep -vqE '^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-nistp[0-9]+|sk-(ssh-ed25519|ecdsa-sha2-nistp256))@?' "$ROOT/$auth_keys"; then
    fail "users: $auth_keys contains a line that is not a public key"
  else
    ok "users: $auth_keys has $(wc -l < "$ROOT/$auth_keys") public key(s)"
  fi
else
  fail "users: $auth_keys missing or empty"
fi
check_file_contains users etc/group "^sudo:.*\bboxp\b"
check_file_contains users etc/passwd "^boxp:"

# --- first boot services ------------------------------------------------------
check_present grow-rootfs usr/local/sbin/lolice-grow-rootfs
check_present grow-rootfs etc/systemd/system/multi-user.target.wants/lolice-grow-rootfs.service
# systemd treats a missing/empty file or the literal "uninitialized" as first boot.
if [ -f "$ROOT/etc/machine-id" ] && [ -s "$ROOT/etc/machine-id" ] \
   && [ "$(tr -d '[:space:]' < "$ROOT/etc/machine-id")" != uninitialized ]; then
  fail "sysprep: etc/machine-id is not empty ($(tr -d '[:space:]' < "$ROOT/etc/machine-id"))"
else
  ok "sysprep: machine-id reset"
fi
if [ -e "$ROOT/etc/cloud/cloud-init.disabled" ]; then
  ok "cloud-init: disabled marker present"
elif [ -d "$ROOT/etc/cloud" ]; then
  warn "cloud-init: installed and not disabled; relies on ds-identify finding no datasource on bare metal"
fi

# --- longhorn multipath (BOXP-267) -------------------------------------------
multipath_conf=etc/multipath/conf.d/90-longhorn.conf
if [ -f "$ROOT/$multipath_conf" ] && grep -q 'VIRTUAL-DISK' "$ROOT/$multipath_conf"; then
  ok "multipath: Longhorn blacklist baked ($multipath_conf)"
elif [ "$REQUIRE_LONGHORN_MULTIPATH" = true ]; then
  fail "multipath: $multipath_conf missing or lacks the Longhorn blacklist"
else
  warn "multipath: $multipath_conf absent (BOXP-267 arch#13808 not in this build)"
fi

# --- build residue / secrets --------------------------------------------------
check_absent residue opt/arch-ansible
check_absent residue opt/ansible-venv
check_absent residue root/.bash_history
check_absent residue home/boxp/.bash_history
secret_hits="$(grep -rIlE \
  -e 'AKIA[0-9A-Z]{16}' \
  -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
  -e 'gh[pousr]_[A-Za-z0-9]{30,}' \
  -e 'CF-Access-Client-Secret' \
  -e 'ANSIBLE_SSH_PRIVATE_KEY' \
  "$ROOT/etc" "$ROOT/home" "$ROOT/root" "$ROOT/opt" 2>/dev/null \
  | grep -vE '/etc/ssl/|/etc/ca-certificates' || true)"
if [ -z "$secret_hits" ]; then
  ok "secrets: no credential patterns in etc/home/root/opt"
else
  fail "secrets: credential patterns found in: $(echo "$secret_hits" | sed "s|^$ROOT/||" | tr '\n' ' ')"
fi

# --- summary ------------------------------------------------------------------
summary="summary: node=${NODE_NAME} failures=${failures} warnings=${warnings}"
record "$summary"
if [ -n "$REPORT" ]; then
  printf '%s\n' "${report_lines[@]}" > "$REPORT"
fi
if [ "$failures" -ne 0 ]; then
  echo "Image verification FAILED for ${NODE_NAME} (${failures} failure(s))" >&2
  exit 1
fi
echo "Image verification passed for ${NODE_NAME}"
