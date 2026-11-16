#!/usr/bin/env bash
set -euo pipefail
HARNESS_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(cd "$HARNESS_DIR/../.." && pwd)
export HARNESS_DIR
# shellcheck source=emulator.env
# shellcheck disable=SC1091 # Paths are resolved from HARNESS_DIR at runtime.
source "$HARNESS_DIR/emulator.env"
for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE; do
  if [[ -v $var ]]; then
    echo "Refusing to run: $var is set" >&2
    exit 1
  fi
done
if [[ $# != 1 && $# != 3 ]] || [[ $# == 3 && $2 != --base-ref ]] || [[ ! ${1:-} =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Usage: $0 <target> [--base-ref <git-ref>]" >&2
  exit 1
fi
target=$1
base_ref=${3:-}
if [[ -n $base_ref ]] && ! git -C "$ROOT" rev-parse --verify --quiet "$base_ref^{commit}" >/dev/null; then
  echo "Base ref not found: $base_ref" >&2
  exit 1
fi
[[ -d "$ROOT/terraform/aws/$target" && -f "$HARNESS_DIR/targets/$target/verify.sh" ]] || {
  echo 'Unknown target' >&2
  exit 1
}
grep -Eq 'backend "local"' "$HARNESS_DIR/emulator-override.tf.tmpl" || {
  echo 'Local backend override missing' >&2
  exit 1
}
tf_version=$(sed -n 's/.*hashicorp\/terraform@v\([0-9.]*\).*/\1/p' "$ROOT/terraform/aws/$target/aqua/imports/terraform.yaml")
[[ $tf_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo 'Terraform version missing' >&2
  exit 1
}
tf_image=hashicorp/terraform:$tf_version
# All temporary data stays in the requested workspace when TMPDIR is configured.
tmp_root=${TMPDIR:-/tmp}
mkdir -p "$tmp_root"
tmp=$(mktemp -d "$tmp_root/boxp-tf-emulator.XXXXXX")
run_id="boxp-tf-$(date +%s)-$$-$RANDOM"
net=$run_id-net
emuhome=$run_id-home
work=$run_id-work
emu=$run_id-emu
helper=$run_id-helper
phase=preflight
start=$SECONDS
names=()
durations=()
finish_phase() {
  local elapsed=$((SECONDS - start))
  names+=("$phase")
  durations+=("$elapsed")
  echo "PHASE $phase: ${elapsed}s"
  start=$SECONDS
}
summary() {
  local i
  {
    echo '| Phase | Seconds |'
    echo '| --- | ---: |'
    for ((i = 0; i < ${#names[@]}; i++)); do echo "| ${names[i]} | ${durations[i]} |"; done
  } | tee "$tmp/summary"
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then cat "$tmp/summary" >>"$GITHUB_STEP_SUMMARY"; fi
}
cleanup() {
  local rc=$?
  trap - EXIT
  finish_phase
  if ((rc != 0)); then
    echo "Failed in phase $phase (exit $rc)" >&2
    docker logs --tail 200 "$emu" >&2 2>/dev/null || :
  fi
  summary
  docker rm -f "$helper" "$emu" >/dev/null 2>&1 || :
  docker volume rm "$work" "$emuhome" >/dev/null 2>&1 || :
  docker network rm "$net" >/dev/null 2>&1 || :
  rm -rf "$tmp"
  exit "$rc"
}
trap cleanup EXIT
finish_phase
phase=build
case $(uname -m) in x86_64 | aarch64) arch=$(uname -m) ;; arm64) arch=aarch64 ;; *)
  echo 'Unsupported architecture' >&2
  exit 1
  ;;
esac
cache=${TF_EMULATOR_CACHE_DIR:-$tmp/cache}
mkdir -p "$cache" "$tmp/build" "$tmp/gnupg"
chmod 700 "$tmp/gnupg"
pkg="$cache/aws-emulator-$AWS_EMULATOR_VERSION-$arch.rpm"
sig=$pkg.sig
url="https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-${AWS_EMULATOR_VERSION}-1-${arch}.rpm"
[[ -f $pkg ]] || curl -fsSL --retry 3 "$url" -o "$pkg"
[[ -f $sig ]] || curl -fsSL --retry 3 "$url.sig" -o "$sig"
fingerprint=$(GNUPGHOME="$tmp/gnupg" gpg --batch --show-keys --with-colons "$HARNESS_DIR/aws-emulator-publishing.asc" | awk -F: '$1=="fpr" {print $10; exit}')
[[ $fingerprint == "$AWS_EMULATOR_GPG_FINGERPRINT" ]] || {
  echo 'Unexpected signing key fingerprint' >&2
  exit 1
}
GNUPGHOME="$tmp/gnupg" gpg --batch --dearmor -o "$tmp/key.gpg" <"$HARNESS_DIR/aws-emulator-publishing.asc"
gpgv --keyring "$tmp/key.gpg" "$sig" "$pkg"
cp "$pkg" "$tmp/build/aws-emulator.rpm"
cp "$HARNESS_DIR/emulator/Dockerfile" "$tmp/build/Dockerfile"
image=boxp-arch-aws-emulator:$AWS_EMULATOR_VERSION
if docker buildx version >/dev/null 2>&1; then docker build -t "$image" "$tmp/build"; else DOCKER_BUILDKIT=0 docker build -t "$image" "$tmp/build"; fi
finish_phase
phase=isolation
docker network create --internal "$net" >/dev/null
docker volume create "$emuhome" >/dev/null
docker volume create "$work" >/dev/null
docker run -d --name "$emu" --network "$net" --memory=2g --memory-swap=2g -v "$emuhome:/home/emulator/.aws/emulator" "$image" >/dev/null
for ((i = 0; i < 60; i++)); do
  if docker exec "$emu" sh -c 'test -r "$HOME/.aws/emulator/9297/config" && test -r "$HOME/.aws/emulator/9297/emulator_credentials" && curl -sf --cacert "$HOME/.aws/emulator/9297/ca.pem" https://127.0.0.1:9297/__admin/health' >/dev/null 2>&1; then break; fi
  sleep 1
done
((i < 60)) || {
  echo 'Emulator health timed out' >&2
  exit 1
}
docker exec "$emu" aws-emulator -v
# The emulator prints its telemetry state before sending anything; require it to be disabled.
docker logs "$emu" 2>&1 | grep -q 'telemetry: disabled' || {
  echo 'Emulator telemetry is not disabled' >&2
  exit 1
}
docker exec "$emu" sh -c "command -v getent >/dev/null && command -v curl >/dev/null"
for host in sts.amazonaws.com s3.ap-northeast-1.amazonaws.com; do
  if docker exec "$emu" curl --connect-timeout 5 --max-time 10 -fsS "https://$host" >/dev/null 2>&1; then
    echo "Isolation failure: $host reachable" >&2
    exit 1
  fi
  if docker exec "$emu" getent hosts "$host" >/dev/null 2>&1; then
    echo "Isolation failure: $host resolved" >&2
    exit 1
  fi
done
# shellcheck source=lib.sh
# shellcheck disable=SC1091 # Paths are resolved from HARNESS_DIR at runtime.
source "$HARNESS_DIR/lib.sh"
[[ $(aws sts get-caller-identity --query Account --output text) == 000000000000 ]] || {
  echo 'Wrong AWS account' >&2
  exit 1
}
finish_phase
phase=init
# A helper container allows docker cp with a remote daemon and owns the volume as UID 1000.
docker create --name "$helper" -v "$work:/work" --entrypoint /bin/sh "$tf_image" -c 'sleep 3600' >/dev/null
docker start "$helper" >/dev/null
docker exec "$helper" sh -c 'mkdir -p /work/config /work/state && chown -R 1000:1000 /work'
copy_config() {
  docker exec "$helper" sh -c 'rm -f /work/config/*.tf /work/config/.terraform.lock.hcl'
  docker cp "$1/." "$helper:/work/config/"
  docker cp "$HARNESS_DIR/emulator-override.tf.tmpl" "$helper:/work/config/zz_emulator_override.tf"
  docker exec "$helper" chown -R 1000:1000 /work
}
prepare_head() {
  mkdir -p "$tmp/head"
  cp "$ROOT/terraform/aws/$target/"*.tf "$ROOT/terraform/aws/$target/.terraform.lock.hcl" "$tmp/head/"
}
init() { docker run --rm -u 1000 -e HOME=/tmp -e TF_IN_AUTOMATION=1 -v "$work:/work" -w /work/config "$tf_image" init -input=false -lockfile=readonly; }
prepare_head
if [[ -n $base_ref ]] && git -C "$ROOT" cat-file -e "$base_ref:terraform/aws/$target" 2>/dev/null; then
  mkdir -p "$tmp/base"
  git -C "$ROOT" archive "$base_ref" "terraform/aws/$target" | tar -x -C "$tmp/base"
  copy_config "$tmp/base/terraform/aws/$target"
  init
  tf validate
  finish_phase
  phase=update
  tf apply -input=false -auto-approve
  copy_config "$tmp/head"
  init
  tf validate
  tf apply -input=false -auto-approve
  "$HARNESS_DIR/targets/$target/verify.sh"
  tf plan -input=false -detailed-exitcode
elif [[ -n $base_ref ]]; then
  echo "UPDATE: not applicable (target absent at $base_ref)"
  copy_config "$tmp/head"
  init
  tf validate
else
  echo 'UPDATE: not requested'
  copy_config "$tmp/head"
  init
  tf validate
fi
finish_phase
phase=green
tf plan -input=false -out=/work/green.plan
tf apply -input=false /work/green.plan
"$HARNESS_DIR/targets/$target/verify.sh"
tf plan -input=false -detailed-exitcode
finish_phase
phase=red-drift
"$HARNESS_DIR/targets/$target/drift.sh"
rc=0
tf plan -input=false -detailed-exitcode || rc=$?
[[ $rc == 2 ]] || {
  echo "Expected drift exit 2, got $rc" >&2
  exit 1
}
tf apply -input=false -auto-approve
"$HARNESS_DIR/targets/$target/verify.sh"
tf plan -input=false -detailed-exitcode
finish_phase
phase=red-mutation
docker cp "$HARNESS_DIR/targets/$target/red-mutation.tf" "$helper:/work/config/zz_red_override.tf"
tf apply -input=false -auto-approve
rc=0
out=$("$HARNESS_DIR/targets/$target/verify.sh") || rc=$?
printf '%s\n' "$out"
[[ $rc == 1 ]] || {
  echo "Mutation not detected (verification exit $rc)" >&2
  exit 1
}
# Only the checks listed in red-mutation.expect may fail; any other failure (e.g. an API error) must not count as detection.
failed_checks=$(grep '^FAIL: ' <<<"$out" | sed -e 's/^FAIL: //' -e 's/ (actual:.*//' | LC_ALL=C sort -u)
expected_checks=$(LC_ALL=C sort -u "$HARNESS_DIR/targets/$target/red-mutation.expect")
[[ -n $expected_checks && $failed_checks == "$expected_checks" ]] || {
  printf 'Unexpected failing checks:\n%s\nexpected:\n%s\n' "$failed_checks" "$expected_checks" >&2
  exit 1
}
docker exec "$helper" rm /work/config/zz_red_override.tf
tf apply -input=false -auto-approve
"$HARNESS_DIR/targets/$target/verify.sh"
tf plan -input=false -detailed-exitcode
finish_phase
phase=destroy
tf destroy -input=false -auto-approve
"$HARNESS_DIR/targets/$target/verify-destroyed.sh"
