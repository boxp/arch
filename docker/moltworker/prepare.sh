#!/usr/bin/env bash
set -euo pipefail

# prepare.sh - Clone upstream cloudflare/moltworker at pinned SHA and apply overlay
#
# Usage: bash prepare.sh
#
# Reads UPSTREAM_REF for the pinned commit SHA, clones (or fetches) the upstream
# repository into .upstream/, installs dependencies, and copies overlay files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="${SCRIPT_DIR}/.upstream"
UPSTREAM_REPO="https://github.com/cloudflare/moltworker.git"
UPSTREAM_REF_FILE="${SCRIPT_DIR}/UPSTREAM_REF"
OVERLAY_DIR="${SCRIPT_DIR}/overlay"

if [ ! -f "${UPSTREAM_REF_FILE}" ]; then
  echo "ERROR: UPSTREAM_REF file not found at ${UPSTREAM_REF_FILE}" >&2
  exit 1
fi

UPSTREAM_REF="$(tr -d '[:space:]' < "${UPSTREAM_REF_FILE}")"

if [ -z "${UPSTREAM_REF}" ]; then
  echo "ERROR: UPSTREAM_REF is empty" >&2
  exit 1
fi

echo "==> Upstream ref: ${UPSTREAM_REF}"

# Clone or fetch
if [ ! -d "${UPSTREAM_DIR}/.git" ]; then
  echo "==> Cloning upstream repository..."
  git clone --no-checkout "${UPSTREAM_REPO}" "${UPSTREAM_DIR}"
else
  echo "==> Fetching upstream updates..."
  git -C "${UPSTREAM_DIR}" fetch origin
fi

# Clean working tree before checkout (overlay/npm install may have dirtied it)
if [ -d "${UPSTREAM_DIR}/.git" ]; then
  echo "==> Cleaning upstream working tree..."
  git -C "${UPSTREAM_DIR}" reset --hard HEAD
  git -C "${UPSTREAM_DIR}" clean -fd
fi

echo "==> Checking out ${UPSTREAM_REF}..."
git -C "${UPSTREAM_DIR}" checkout "${UPSTREAM_REF}"

# Install npm dependencies in upstream
echo "==> Installing upstream dependencies..."
(cd "${UPSTREAM_DIR}" && npm install)

# Apply overlay files
if [ -d "${OVERLAY_DIR}" ]; then
  echo "==> Applying overlay files..."
  cp -rv "${OVERLAY_DIR}"/. "${UPSTREAM_DIR}"/
fi

echo "==> Done. Deploy from: ${UPSTREAM_DIR}"
