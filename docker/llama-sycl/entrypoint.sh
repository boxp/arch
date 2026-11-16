#!/usr/bin/env bash
set -euo pipefail

if [[ -r /opt/intel/oneapi/setvars.sh ]]; then
  set +u
  # oneAPI is installed in the image, not on the lint host.
  # shellcheck source=/dev/null
  source /opt/intel/oneapi/setvars.sh >/dev/null 2>&1
  set -u
fi

exec "$@"
