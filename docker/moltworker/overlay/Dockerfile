# Moltworker - OpenClaw Sandbox Container (boxp overlay)
# Based on pre-built upstream cloudflare/moltworker image with boxp-specific additions:
#   - Added: gh CLI, git, jq, curl
# This runs inside Cloudflare Containers (linux/amd64)
FROM ghcr.io/boxp/arch/moltworker-base:latest

# Install boxp-specific tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install gh CLI (boxp addition)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

