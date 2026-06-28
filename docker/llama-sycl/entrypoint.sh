#!/usr/bin/env bash
set -euo pipefail

if [[ -r /opt/intel/oneapi/setvars.sh ]]; then
  # shellcheck disable=SC1091
  set +u
  source /opt/intel/oneapi/setvars.sh >/dev/null 2>&1
  set -u
fi

exec "$@"
