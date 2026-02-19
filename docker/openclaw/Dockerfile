# =============================================================================
# boxp/arch openclaw Dockerfile
# Based on: cloudflare/moltworker upstream Dockerfile
# Upstream ref: https://github.com/cloudflare/moltworker/blob/main/Dockerfile
# =============================================================================

# --- Multi-stage: build tools not available in upstream base ---
FROM docker:29-cli@sha256:1d6d751f1d68d1a5142c23c730ef5ecc976a8e050fa08c3cdb09f7e2e54a4439 AS docker-cli

FROM golang:1.26@sha256:c83e68f3ebb6943a2904fa66348867d108119890a2c6a2e6f07b38d0eb6c25c5 AS go-tools
RUN go install github.com/x-motemen/ghq@v1.8.1 && \
    go install github.com/d-kuro/gwq/cmd/gwq@v0.0.13 && \
    go install github.com/grafana/mcp-grafana/cmd/mcp-grafana@v0.10.0

FROM debian:bookworm-slim@sha256:98f4b71de414932439ac6ac690d7060df1f27161073c5036a7553723881bffbe AS babashka-download
ARG BABASHKA_VERSION=1.12.214
ARG BABASHKA_SHA256=2926098700f6e230b21007871b47844280d29e641959b693535a5d74e4dab4a3
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fSL -o babashka.tar.gz \
      "https://github.com/babashka/babashka/releases/download/v${BABASHKA_VERSION}/babashka-${BABASHKA_VERSION}-linux-amd64-static.tar.gz" && \
    echo "${BABASHKA_SHA256}  babashka.tar.gz" | sha256sum -c - && \
    tar xzf babashka.tar.gz && \
    chmod +x bb

# =============================================================================
# Main stage: upstream moltworker base
# Upstream: docker.io/cloudflare/sandbox:0.7.0
# =============================================================================
FROM docker.io/cloudflare/sandbox:0.7.0

# --- BEGIN: upstream moltworker Dockerfile (verbatim) ---

# Install Node.js 22 (required by OpenClaw) and rclone (for R2 persistence)
# The base image has Node 20, we need to replace it with Node 22
# Using direct binary download for reliability
ENV NODE_VERSION=22.13.1
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && apt-get update && apt-get install -y xz-utils ca-certificates rclone \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install pnpm globally
RUN npm install -g pnpm

# Install OpenClaw (formerly clawdbot/moltbot)
# Pin to specific version for reproducible builds
# NOTE: bumped from upstream 2026.2.3 to 2026.2.15 for this deployment
RUN npm install -g openclaw@2026.2.15 \
    && openclaw --version

# Create OpenClaw directories
# Legacy .clawdbot paths are kept for R2 backup migration
RUN mkdir -p /root/.openclaw \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# Copy startup script
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh

# Copy custom skills
COPY skills/ /root/clawd/skills/

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789

# --- END: upstream moltworker Dockerfile ---

# =============================================================================
# boxp customizations (minimal diff from upstream)
# See: docs/project_docs/openclaw/T-20260219-012-dockerfile-upstream-diff.md
# =============================================================================

# Install gh CLI and jq (required for GitHub operations and script processing)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl gpg && \
    mkdir -p -m 755 /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends gh jq && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy Docker CLI (required for container operations)
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# Copy ghq and gwq (required for repository/worktree management)
COPY --from=go-tools /go/bin/ghq /usr/local/bin/ghq
COPY --from=go-tools /go/bin/gwq /usr/local/bin/gwq

# Copy mcp-grafana (Grafana MCP Server for metrics context)
COPY --from=go-tools /go/bin/mcp-grafana /usr/local/bin/mcp-grafana

# Copy Babashka (Clojure scripting runtime)
COPY --from=babashka-download /bb /usr/local/bin/bb

# Install Codex CLI globally
RUN npm install -g @openai/codex

# Switch to non-root user for security
USER node

# Install Claude Code CLI (user-level)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Create trusted workspace config for Claude Code
RUN mkdir -p /home/node/.claude && \
    echo '{"trustedWorkspaces":["/home/node/ghq/**","/home/node/.openclaw/workspace/**"]}' \
      > /home/node/.claude/config.json
COPY --chown=node:node settings.json /home/node/.claude/settings.json
COPY --chown=node:node mcp-config.json /home/node/.claude/mcp-config.json

ENV PATH="/home/node/.local/bin:${PATH}"
