FROM ubuntu:26.04@sha256:f3d28607ddd78734bb7f71f117f3c6706c666b8b76cbff7c9ff6e5718d46ff64

ARG CODEX_VERSION=0.133.0
ARG EVEN_TERMINAL_VERSION=0.7.9
ARG OBSIDIAN_HEADLESS_VERSION=0.0.8
ARG GHQ_VERSION=1.10.1
ARG GWQ_VERSION=0.1.1
ARG CEEKER_VERSION=0.3.7
ARG BABASHKA_VERSION=1.12.218
ARG LAZYGIT_VERSION=0.61.1
ARG YAZI_VERSION=26.5.6
ARG NODE_MAJOR=24

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash-completion \
      ca-certificates \
      curl \
      fzf \
      git \
      gnupg \
      gzip \
      jq \
      less \
      locales \
      openssh-server \
      ripgrep \
      sudo \
      tar \
      tmux \
      unzip \
      vim \
      xz-utils \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g \
      "@openai/codex@${CODEX_VERSION}" \
      "@evenrealities/even-terminal@${EVEN_TERMINAL_VERSION}" \
      "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}" \
    && npm cache clean --force

RUN set -eux; \
    tmp="$(mktemp -d)"; \
    curl -fsSL "https://github.com/x-motemen/ghq/releases/download/v${GHQ_VERSION}/ghq_linux_amd64.zip" -o "$tmp/ghq.zip"; \
    unzip -q "$tmp/ghq.zip" -d "$tmp/ghq"; \
    install -m 0755 "$(find "$tmp/ghq" -type f -name ghq | head -n 1)" /usr/local/bin/ghq; \
    curl -fsSL "https://github.com/d-kuro/gwq/releases/download/v${GWQ_VERSION}/gwq_Linux_x86_64.tar.gz" -o "$tmp/gwq.tar.gz"; \
    tar -xzf "$tmp/gwq.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -name gwq | head -n 1)" /usr/local/bin/gwq; \
    curl -fsSL "https://github.com/boxp/ceeker/releases/download/v${CEEKER_VERSION}/ceeker-linux-amd64.tar.gz" -o "$tmp/ceeker.tar.gz"; \
    tar -xzf "$tmp/ceeker.tar.gz" -C "$tmp"; \
    install -m 0755 "$tmp/ceeker-linux-amd64" /usr/local/bin/ceeker; \
    curl -fsSL "https://github.com/babashka/babashka/releases/download/v${BABASHKA_VERSION}/babashka-${BABASHKA_VERSION}-linux-amd64-static.tar.gz" -o "$tmp/bb.tar.gz"; \
    tar -xzf "$tmp/bb.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -name bb | head -n 1)" /usr/local/bin/bb; \
    curl -fsSL "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_linux_x86_64.tar.gz" -o "$tmp/lazygit.tar.gz"; \
    tar -xzf "$tmp/lazygit.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -name lazygit | head -n 1)" /usr/local/bin/lazygit; \
    curl -fsSL "https://github.com/sxyazi/yazi/releases/download/v${YAZI_VERSION}/yazi-x86_64-unknown-linux-gnu.zip" -o "$tmp/yazi.zip"; \
    unzip -q "$tmp/yazi.zip" -d "$tmp/yazi"; \
    install -m 0755 "$(find "$tmp/yazi" -type f -name yazi | head -n 1)" /usr/local/bin/yazi; \
    install -m 0755 "$(find "$tmp/yazi" -type f -name ya | head -n 1)" /usr/local/bin/ya; \
    rm -rf "$tmp"

RUN locale-gen en_US.UTF-8 \
    && if getent passwd 1000 >/dev/null; then \
      existing_user="$(getent passwd 1000 | cut -d: -f1)"; \
      usermod --login boxp --home /home/boxp --move-home "$existing_user"; \
    else \
      useradd --create-home --shell /bin/bash --uid 1000 boxp; \
    fi \
    && usermod -aG sudo boxp \
    && echo "boxp ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/boxp \
    && chmod 0440 /etc/sudoers.d/boxp \
    && install -d -m 0755 /run/sshd

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    PATH=/home/boxp/.local/bin:/home/boxp/go/bin:/usr/local/bin:/usr/bin:/bin

COPY entrypoint.sh /usr/local/bin/codex-workspace-entrypoint
RUN chmod 0755 /usr/local/bin/codex-workspace-entrypoint

EXPOSE 2222 3456
ENTRYPOINT ["/usr/local/bin/codex-workspace-entrypoint"]
