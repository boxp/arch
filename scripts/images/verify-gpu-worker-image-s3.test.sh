#!/usr/bin/env bash
# Tests for verify-gpu-worker-image-s3.sh using a fake `aws` on PATH.
# The fake serves objects from a directory tree ($FAKE_S3/<key>) and records
# every invocation so the test can assert the script never writes.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/verify-gpu-worker-image-s3.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export FAKE_S3="$work/s3"
export FAKE_LOG="$work/aws.log"
export FAKE_MTIME="2026-10-22T12:00:00+00:00"
export FAKE_OTHER_MTIME="2026-10-22T09:00:00+00:00"
mkdir -p "$work/bin" "$FAKE_S3"
cat > "$work/bin/aws" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$FAKE_LOG"
key=""; bucket=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  case "${args[$i]}" in
    --key) key="${args[$((i+1))]}" ;;
    --bucket) bucket="${args[$((i+1))]}" ;;
    s3://*) src="${args[$i]#s3://}"; bucket="${src%%/*}"; key="${src#*/}" ;;
  esac
done
path="$FAKE_S3/$key"
case "$1 $2" in
  "s3api head-object")
    [ -f "$path" ] || { echo "An error occurred (404) when calling the HeadObject operation: Not Found" >&2; exit 254; }
    mtime="$FAKE_MTIME"; case "$key" in images/other-*/latest.img.xz) mtime="$FAKE_OTHER_MTIME";; esac
    printf '{"ContentLength": %s, "LastModified": "%s", "ETag": "\\"etag-%s\\""}\n' "$(stat -c %s "$path")" "$mtime" "$(basename "$key")" ;;
  "s3api get-object-tagging")
    [ -f "$path" ] || exit 254
    if [ -n "${FAKE_TAG_ERROR:-}" ]; then echo "boom" >&2; exit 1; fi
    if [ -n "${FAKE_TAG_DENY:-}" ]; then
      echo "aws: [ERROR]: An error occurred (AccessDenied) when calling the GetObjectTagging operation: not authorized to perform: s3:GetObjectTagging" >&2
      exit 254
    fi
    printf '{"TagSet": [{"Key": "NodeName", "Value": "%s"}, {"Key": "GitSHA", "Value": "%s"}]}\n' "${FAKE_TAG_NODE:-golyat-9}" "${FAKE_TAG_SHA:-deadbeef}" ;;
  "s3 cp")
    [ "${args[3]}" = "-" ] || { echo "fake aws: only downloads to stdout are supported" >&2; exit 1; }
    [ -f "$path" ] || exit 1
    cat "$path" ;;
  *) echo "fake aws: unexpected call: $*" >&2; exit 1 ;;
esac
FAKE
chmod +x "$work/bin/aws"
export PATH="$work/bin:$PATH"

cat > "$work/worker_nodes.yml" <<'YML'
---
worker_nodes:
  golyat-9:
    ip: "192.168.10.199"
  other-a:
    ip: "192.168.10.198"
  other-b:
    ip: "192.168.10.197"
YML

node=golyat-9
name="ubuntu-noble-amd64-gpu-worker-${node}-20261022-120000-abcdef01.img.xz"
image="$work/$name"
head -c 4096 /dev/urandom > "$image"
digest="$(sha256sum "$image" | cut -d' ' -f1)"
printf '%s  %s\n' "$digest" "$name" > "$image.sha256"

populate() {
  rm -rf "$FAKE_S3"
  mkdir -p "$FAKE_S3/images/artifacts/$node" "$FAKE_S3/images/$node" "$FAKE_S3/images/other-a"
  cp "$image" "$FAKE_S3/images/artifacts/$node/$name"
  cp "$image.sha256" "$FAKE_S3/images/artifacts/$node/$name.sha256"
  echo '{}' > "$FAKE_S3/images/artifacts/$node/image-info.json"
  echo 'summary: ok' > "$FAKE_S3/images/artifacts/$node/${name%.img.xz}.verify.txt"
  cp "$image" "$FAKE_S3/images/$node/latest.img.xz"
  printf '%s  latest.img.xz\n' "$digest" > "$FAKE_S3/images/$node/latest.img.xz.sha256"
  echo '{}' > "$FAKE_S3/images/$node/image-info.json"
  echo 'summary: ok' > "$FAKE_S3/images/$node/latest.verify.txt"
  # other-a has an older latest image, other-b has never been built
  echo old > "$FAKE_S3/images/other-a/latest.img.xz"
  : > "$FAKE_LOG"
}

pass=0; failc=0
check() {
  local label="$1" want="$2"; shift 2
  local got=0
  "$@" > "$work/out.txt" 2>&1 || got=$?
  if [ "$got" = "$want" ]; then
    pass=$((pass+1)); echo "PASS: $label"
  else
    failc=$((failc+1)); echo "FAIL: $label (exit $got, wanted $want)"; sed 's/^/    /' "$work/out.txt"
  fi
}

run() {
  "$script" --bucket test-bucket --node "$node" --image "$image" --checksum-file "$image.sha256" \
    --worker-nodes-file "$work/worker_nodes.yml" --since "2026-10-22T11:00:00+00:00" \
    --git-sha deadbeef --report "$work/report.md" "$@"
}

populate; check "intact upload passes" 0 run
grep -q "s3-verification: passed" "$work/report.md" || { echo "FAIL: report lacks passed line"; failc=$((failc+1)); }
grep -q "images/other-a/latest.img.xz | 2026-10-22T09:00:00+00:00 | unchanged" "$work/report.md" || { echo "FAIL: other-a row"; failc=$((failc+1)); }
grep -q "images/other-b/latest.img.xz | - | absent" "$work/report.md" || { echo "FAIL: other-b row"; failc=$((failc+1)); }
if grep -qE "s3 cp [^ ]+ s3://|put-object|copy-object|delete" "$FAKE_LOG"; then echo "FAIL: script wrote to S3"; failc=$((failc+1)); else pass=$((pass+1)); echo "PASS: read-only against S3"; fi

populate; rm "$FAKE_S3/images/$node/latest.verify.txt"; check "missing latest.verify.txt fails" 1 run
populate; echo corrupt >> "$FAKE_S3/images/$node/latest.img.xz"; check "latest copy with different size fails" 1 run
populate; head -c 4096 /dev/urandom > "$FAKE_S3/images/artifacts/$node/$name"; check "artifact with same size but different content fails" 1 run
populate; printf '%064d  x\n' 0 > "$FAKE_S3/images/$node/latest.img.xz.sha256"; check "stored checksum file mismatch fails" 1 run
populate; FAKE_TAG_NODE=golyat-4 check "wrong NodeName tag fails" 1 run
populate; FAKE_TAG_SHA=other check "wrong GitSHA tag fails" 1 run
populate; FAKE_TAG_DENY=1 check "GetObjectTagging AccessDenied is only a warning" 0 run
grep -q "s3-verification: passed (warnings: 1)" "$work/report.md" || { echo "FAIL: AccessDenied not reported as warning"; failc=$((failc+1)); }
populate; FAKE_TAG_ERROR=1 check "other tagging errors still fail" 1 run
populate; FAKE_OTHER_MTIME="2026-10-22T11:30:00+00:00" check "other node latest modified during run without its own image-info fails" 1 run
populate; echo '{"node_name": "golyat-9", "image_file": "ubuntu-noble-amd64-gpu-worker-golyat-9-x.img.xz"}' > "$FAKE_S3/images/other-a/image-info.json"
FAKE_OTHER_MTIME="2026-10-22T11:30:00+00:00" check "other node latest overwritten with this node's image fails" 1 run
populate; echo '{"node_name": "other-a", "image_file": "ubuntu-noble-amd64-gpu-worker-other-a-20261022-113000-abc.img.xz"}' > "$FAKE_S3/images/other-a/image-info.json"
FAKE_OTHER_MTIME="2026-10-22T11:30:00+00:00" check "other node latest modified by its own concurrent build is a warning" 0 run
grep -q "modified by a concurrent other-a build" "$work/report.md" || { echo "FAIL: concurrent build not reported"; failc=$((failc+1)); }
populate; check "usage error without --image" 2 "$script" --bucket b --node n

echo "$pass passed, $failc failed"
[ "$failc" -eq 0 ]
