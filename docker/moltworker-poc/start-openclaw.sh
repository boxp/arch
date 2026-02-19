#!/bin/bash
set -euo pipefail

# Start openclaw server
# Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
# are injected by the Worker via Cloudflare Secrets.
exec openclaw serve --port 18789
