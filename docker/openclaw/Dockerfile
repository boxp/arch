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

FROM ghcr.io/openclaw/openclaw:2026.2.19@sha256:5352d3ababbc12237fda60fe00a25237441eb7bb5e3d3062a6b0b5fbd938734d

USER root

# Install gh CLI
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

# Copy Docker CLI from docker:27-cli
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# Copy ghq and gwq from go-tools
COPY --from=go-tools /go/bin/ghq /usr/local/bin/ghq
COPY --from=go-tools /go/bin/gwq /usr/local/bin/gwq

# Copy mcp-grafana from go-tools (Grafana MCP Server for metrics context)
COPY --from=go-tools /go/bin/mcp-grafana /usr/local/bin/mcp-grafana

# Copy Babashka from babashka-download
COPY --from=babashka-download /bb /usr/local/bin/bb

# Install Codex CLI globally
RUN npm install -g @openai/codex

USER node

# Install Claude Code CLI (user-level)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Create trusted workspace config for Claude Code
RUN mkdir -p /home/node/.claude && \
    echo '{"trustedWorkspaces":["/home/node/ghq/**","/home/node/.openclaw/workspace/**"]}' \
      > /home/node/.claude/config.json
COPY --chown=node:node settings.json /home/node/.claude/settings.json
COPY --chown=node:node mcp-config.json /home/node/.claude/mcp-config.json

# Copy workspace scripts (board archive, etc.)
COPY --chown=node:node scripts/ /home/node/.openclaw/scripts/

ENV PATH="/home/node/.local/bin:${PATH}"
