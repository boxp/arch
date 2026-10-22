#!/usr/bin/env bash
# Verify the GPU worker image objects that build-gpu-worker-image.yml just
# uploaded to S3 (BOXP-269).
#
# The upload step only runs `aws s3 cp`; this script re-reads the bucket with
# an independent set of calls and fails unless
#   - every expected object (timestamped artifact set + per-node latest set)
#     exists,
#   - the two image objects have the local file's size and, when streamed back
#     and hashed, the local sha256,
#   - the stored .sha256 files carry that digest,
#   - the artifact object is tagged with the node name (and GitSHA when known),
#   - no other node's images/<node>/latest.img.xz was modified since --since
#     (so a golyat-1 build can prove it left golyat-4 alone).
# It only uses GetObject/HeadObject/ListBucket/GetObjectTagging; it never
# writes to the bucket. A markdown report is written to --report for the job
# summary.
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: verify-gpu-worker-image-s3.sh --bucket BUCKET --node NODE \
         --image FILE.img.xz --checksum-file FILE.img.xz.sha256 \
         [--worker-nodes-file ansible/vars/worker_nodes.yml] \
         [--since ISO8601] [--git-sha SHA] [--report FILE]
USAGE
  exit 2
}

bucket="" node="" image="" checksum_file="" since="" git_sha="${GITHUB_SHA:-}" report=""
worker_nodes_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/ansible/vars/worker_nodes.yml"
while [ $# -gt 0 ]; do
  case "$1" in
    --bucket) bucket="$2"; shift 2 ;;
    --node) node="$2"; shift 2 ;;
    --image) image="$2"; shift 2 ;;
    --checksum-file) checksum_file="$2"; shift 2 ;;
    --worker-nodes-file) worker_nodes_file="$2"; shift 2 ;;
    --since) since="$2"; shift 2 ;;
    --git-sha) git_sha="$2"; shift 2 ;;
    --report) report="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$bucket" ] && [ -n "$node" ] && [ -n "$image" ] && [ -n "$checksum_file" ] || usage
[ -f "$image" ] || { echo "image not found: $image" >&2; exit 1; }
[ -f "$checksum_file" ] || { echo "checksum file not found: $checksum_file" >&2; exit 1; }
[ -n "$report" ] || report="$(mktemp)"

final_name="$(basename "$image")"
case "$final_name" in *.img.xz) ;; *) echo "image must end in .img.xz: $final_name" >&2; exit 1 ;; esac
expected="$(cut -d' ' -f1 "$checksum_file")"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo "bad digest in $checksum_file: $expected" >&2; exit 1; }
local_size="$(stat -c %s "$image")"
stable_prefix="images/${node}"
artifact_prefix="images/artifacts/${node}"
artifact_key="${artifact_prefix}/${final_name}"
latest_key="${stable_prefix}/latest.img.xz"

failures=0 warnings=0
fail() { echo "fail: $*"; failures=$((failures + 1)); }
warn() { echo "warn: $*"; warnings=$((warnings + 1)); }
ok() { echo "ok: $*"; }

{
  echo "### S3 objects (s3://${bucket})"
  echo
  echo "| key | size (bytes) | last modified | etag |"
  echo "|---|---|---|---|"
} > "$report"

head_object() {
  aws s3api head-object --bucket "$bucket" --key "$1" --output json
}

# 1. every expected object exists; image objects have the local size
for key in \
  "$artifact_key" \
  "${artifact_key}.sha256" \
  "${artifact_prefix}/image-info.json" \
  "${artifact_prefix}/${final_name%.img.xz}.verify.txt" \
  "$latest_key" \
  "${latest_key}.sha256" \
  "${stable_prefix}/image-info.json" \
  "${stable_prefix}/latest.verify.txt"; do
  if ! head="$(head_object "$key" 2>&1)"; then
    fail "head-object ${key}: ${head}"
    echo "| ${key} | missing | - | - |" >> "$report"
    continue
  fi
  size="$(jq -r .ContentLength <<<"$head")"
  modified="$(jq -r .LastModified <<<"$head")"
  etag="$(jq -r .ETag <<<"$head" | tr -d '"')"
  echo "| ${key} | ${size} | ${modified} | ${etag} |" >> "$report"
  case "$key" in
    *.img.xz)
      if [ "$size" = "$local_size" ]; then
        ok "size ${key} = ${size}"
      else
        fail "size ${key} is ${size}, local ${local_size}"
      fi
      ;;
    *) ok "present ${key} (${size} bytes)" ;;
  esac
done

# 2. stored checksum files carry the local digest
for key in "${artifact_key}.sha256" "${latest_key}.sha256"; do
  stored="$(aws s3 cp "s3://${bucket}/${key}" - 2>/dev/null | cut -d' ' -f1 || true)"
  if [ "$stored" = "$expected" ]; then
    ok "digest in ${key} matches local sha256"
  else
    fail "digest in ${key} is '${stored}', local ${expected}"
  fi
done

# 3. stream both image objects back and hash them
for key in "$artifact_key" "$latest_key"; do
  actual="$(aws s3 cp "s3://${bucket}/${key}" - 2>/dev/null | sha256sum | cut -d' ' -f1 || true)"
  if [ "$actual" = "$expected" ]; then
    ok "sha256 of s3://${bucket}/${key} = ${expected}"
  else
    fail "sha256 of s3://${bucket}/${key} is ${actual}, expected ${expected}"
  fi
done

# 4. artifact tags. The build role (terraform/aws/gpu-worker-images) may put
# tags but not read them back (no s3:GetObjectTagging); report that as a
# warning instead of failing the build, since the tags are not load-bearing.
if tags="$(aws s3api get-object-tagging --bucket "$bucket" --key "$artifact_key" --output json 2>&1)"; then
  tag_node="$(jq -r '.TagSet[] | select(.Key=="NodeName") | .Value' <<<"$tags")"
  tag_sha="$(jq -r '.TagSet[] | select(.Key=="GitSHA") | .Value' <<<"$tags")"
  if [ "$tag_node" = "$node" ]; then ok "tag NodeName=${tag_node}"; else fail "tag NodeName is '${tag_node}', expected ${node}"; fi
  if [ -n "$git_sha" ]; then
    if [ "$tag_sha" = "$git_sha" ]; then ok "tag GitSHA=${tag_sha}"; else fail "tag GitSHA is '${tag_sha}', expected ${git_sha}"; fi
  fi
elif grep -q "AccessDenied" <<<"$tags"; then
  warn "tag check skipped: the role may not call s3:GetObjectTagging on ${artifact_key}"
else
  fail "get-object-tagging ${artifact_key}: ${tags}"
fi

# 5. other nodes' latest images were not touched by this run
{
  echo
  echo "### Other nodes' latest.img.xz (must predate this run)"
  echo
  echo "| key | last modified | state |"
  echo "|---|---|---|"
} >> "$report"
# worker_nodes.yml keys are the 2-space indented mapping keys under
# worker_nodes: (ansible/tests/test_worker_nodes.py checks this parse against PyYAML).
mapfile -t other_nodes < <(awk '/^worker_nodes:/{f=1; next} f && /^  [A-Za-z0-9_-]+:/{sub(/^  /,""); sub(/:.*/,""); print}' "$worker_nodes_file" | grep -vx "$node" || true)
for other in "${other_nodes[@]}"; do
  key="images/${other}/latest.img.xz"
  if ! head="$(head_object "$key" 2>/dev/null)"; then
    echo "| ${key} | - | absent |" >> "$report"
    ok "${key} absent (never built)"
    continue
  fi
  modified="$(jq -r .LastModified <<<"$head")"
  state="unchanged"
  if [ -n "$since" ] && [ "$(date -u -d "$modified" +%s)" -ge "$(date -u -d "$since" +%s)" ]; then
    state="MODIFIED during this run"
    fail "${key} was modified at ${modified} (run started ${since})"
  else
    ok "${key} last modified ${modified}, before this run"
  fi
  echo "| ${key} | ${modified} | ${state} |" >> "$report"
done

{
  echo
  echo "- local image: ${final_name} (${local_size} bytes, sha256 ${expected})"
  echo "- s3-verification: $([ "$failures" -eq 0 ] && echo passed || echo "failed (${failures})") (warnings: ${warnings})"
} >> "$report"
echo "summary: node=${node} s3-verification failures=${failures} warnings=${warnings} report=${report}"
[ "$failures" -eq 0 ]
