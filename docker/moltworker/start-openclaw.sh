#!/bin/bash
set -euo pipefail

# Start openclaw server
# Environment variables (OPENAI_API_KEY, etc.) are injected by the
# Worker via Cloudflare Secrets. OpenAI subscription features require
# onboarding authentication after OpenClaw starts.
exec openclaw serve --port 18789
