# Moltworker - OpenClaw Sandbox Container
# Based on cloudflare/moltworker Dockerfile
# This runs inside Cloudflare Containers (linux/amd64)
FROM docker.io/cloudflare/sandbox:0.7.0@sha256:7d646f289c3727592cd091d2f5684c322fa25e89bad51055b390bc68cabac832

# Install Node.js 22.13.1
ENV NODE_VERSION=22.13.1
RUN apt-get update && apt-get install -y --no-install-recommends \
    xz-utils \
    ca-certificates \
    rclone \
    curl \
    git \
    jq \
  && ARCH="$(dpkg --print-architecture)" \
  && case "${ARCH}" in \
       amd64) NODE_ARCH="x64" ;; \
       arm64) NODE_ARCH="arm64" ;; \
       *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
     esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
     -o /tmp/node.tar.xz \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm /tmp/node.tar.xz \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install pnpm and openclaw
RUN npm install -g pnpm openclaw@2026.2.3

# Install gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Prepare directories
RUN mkdir -p /root/.openclaw /root/clawd

WORKDIR /root/clawd
EXPOSE 18789

COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh

CMD ["/usr/local/bin/start-openclaw.sh"]
