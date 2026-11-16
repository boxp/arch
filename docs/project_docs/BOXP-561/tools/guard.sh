#!/usr/bin/env bash
set -euo pipefail
exec bb "$(dirname "$0")/guard.bb" "$@"
