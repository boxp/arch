FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker-cli

FROM ghcr.io/openclaw/openclaw:2026.2.9@sha256:7503c7dc56800b61f1223d3c4032ada61a100538a41425210b4043b71f871488

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
    apt-get install -y --no-install-recommends gh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy Docker CLI from docker:27-cli
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# Install Codex CLI globally
RUN npm install -g @openai/codex

USER node

# Install Claude Code CLI (user-level)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Create trusted workspace config for Claude Code
RUN mkdir -p /home/node/.claude && \
    echo '{"trustedWorkspaces":["/home/node/ghq/github.com/*","/home/node/.openclaw/workspace/*"]}' \
      > /home/node/.claude/config.json

ENV PATH="/home/node/.local/bin:${PATH}"
