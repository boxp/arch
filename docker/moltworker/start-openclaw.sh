#!/bin/bash
set -euo pipefail

# Start OpenClaw Gateway ("serve" subcommand is no longer available)
# Environment variables (OPENAI_API_KEY, etc.) are injected by the
# Worker via Cloudflare Secrets. OpenAI subscription features require
# onboarding authentication after OpenClaw starts.

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
