#!/bin/bash
set -euo pipefail

# Start OpenClaw Gateway rather than the removed "serve" subcommand
OPENCLAW_CMD=(
  openclaw
  gateway
  --port
  18789
  --allow-unconfigured
  --bind
  lan
  --verbose
)

if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_CMD+=(--token "$OPENCLAW_GATEWAY_TOKEN")
fi

exec "${OPENCLAW_CMD[@]}"
