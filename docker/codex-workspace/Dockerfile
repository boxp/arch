FROM ubuntu:26.04@sha256:f3d28607ddd78734bb7f71f117f3c6706c666b8b76cbff7c9ff6e5718d46ff64

ARG CODEX_VERSION=0.135.0
ARG EVEN_TERMINAL_VERSION=0.7.9
ARG OBSIDIAN_HEADLESS_VERSION=0.0.10
ARG GH_VERSION=2.93.0
ARG GHQ_VERSION=1.10.1
ARG GWQ_VERSION=0.1.1
ARG CEEKER_VERSION=0.3.7
ARG BABASHKA_VERSION=1.12.218
ARG LAZYGIT_VERSION=0.62.1
ARG YAZI_VERSION=26.5.6
ARG NODE_MAJOR=24
ARG CLOUDFLARE_WARP_DISTRO=noble

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash-completion \
      ca-certificates \
      chromium \
      curl \
      fzf \
      g++ \
      git \
      gnupg \
      gzip \
      jq \
      less \
      lsb-release \
      locales \
      make \
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
    && curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
      | gpg --dearmor -o /etc/apt/keyrings/cloudflare-warp.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/cloudflare-warp.gpg] https://pkg.cloudflareclient.com/ ${CLOUDFLARE_WARP_DISTRO} main" \
      > /etc/apt/sources.list.d/cloudflare-client.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends cloudflare-warp nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g \
      "@openai/codex@${CODEX_VERSION}" \
      "@evenrealities/even-terminal@${EVEN_TERMINAL_VERSION}" \
      "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}" \
    && npm cache clean --force

RUN set -eux; \
    download() { curl --retry 5 --retry-all-errors --connect-timeout 30 --max-time 300 -fsSL "$1" -o "$2"; }; \
    tmp="$(mktemp -d)"; \
    download "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" "$tmp/gh.tar.gz"; \
    tar -xzf "$tmp/gh.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -path '*/bin/gh' | head -n 1)" /usr/local/bin/gh; \
    download "https://github.com/x-motemen/ghq/releases/download/v${GHQ_VERSION}/ghq_linux_amd64.zip" "$tmp/ghq.zip"; \
    unzip -q "$tmp/ghq.zip" -d "$tmp/ghq"; \
    install -m 0755 "$(find "$tmp/ghq" -type f -name ghq | head -n 1)" /usr/local/bin/ghq; \
    download "https://github.com/d-kuro/gwq/releases/download/v${GWQ_VERSION}/gwq_Linux_x86_64.tar.gz" "$tmp/gwq.tar.gz"; \
    tar -xzf "$tmp/gwq.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -name gwq | head -n 1)" /usr/local/bin/gwq; \
    download "https://github.com/boxp/ceeker/releases/download/v${CEEKER_VERSION}/ceeker-linux-amd64.tar.gz" "$tmp/ceeker.tar.gz"; \
    tar -xzf "$tmp/ceeker.tar.gz" -C "$tmp"; \
    install -m 0755 "$tmp/ceeker-linux-amd64" /usr/local/bin/ceeker; \
    download "https://github.com/babashka/babashka/releases/download/v${BABASHKA_VERSION}/babashka-${BABASHKA_VERSION}-linux-amd64-static.tar.gz" "$tmp/bb.tar.gz"; \
    tar -xzf "$tmp/bb.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -name bb | head -n 1)" /usr/local/bin/bb; \
    download "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_linux_x86_64.tar.gz" "$tmp/lazygit.tar.gz"; \
    tar -xzf "$tmp/lazygit.tar.gz" -C "$tmp"; \
    install -m 0755 "$(find "$tmp" -type f -name lazygit | head -n 1)" /usr/local/bin/lazygit; \
    download "https://github.com/sxyazi/yazi/releases/download/v${YAZI_VERSION}/yazi-x86_64-unknown-linux-gnu.zip" "$tmp/yazi.zip"; \
    unzip -q "$tmp/yazi.zip" -d "$tmp/yazi"; \
    install -m 0755 "$(find "$tmp/yazi" -type f -name yazi | head -n 1)" /usr/local/bin/yazi; \
    install -m 0755 "$(find "$tmp/yazi" -type f -name ya | head -n 1)" /usr/local/bin/ya; \
    rm -rf "$tmp"

RUN locale-gen en_US.UTF-8 \
    && if getent group 1000 >/dev/null; then \
      existing_group="$(getent group 1000 | cut -d: -f1)"; \
      if [ "$existing_group" != "boxp" ]; then groupmod --new-name boxp "$existing_group"; fi; \
    else \
      groupadd --gid 1000 boxp; \
    fi \
    && if getent passwd 1000 >/dev/null; then \
      existing_user="$(getent passwd 1000 | cut -d: -f1)"; \
      usermod --login boxp --home /home/boxp --gid 1000 --move-home "$existing_user"; \
    else \
      useradd --create-home --shell /bin/bash --uid 1000 --gid 1000 boxp; \
    fi \
    && usermod -aG sudo boxp \
    && passwd -d boxp \
    && echo "boxp ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/boxp \
    && chmod 0440 /etc/sudoers.d/boxp \
    && install -d -m 0755 /run/sshd

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    CHROME_BIN=/usr/bin/chromium \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    PATH=/home/boxp/.local/bin:/home/boxp/go/bin:/usr/local/bin:/usr/bin:/bin

COPY entrypoint.sh /usr/local/bin/codex-workspace-entrypoint
COPY cron/ /opt/codex-workspace/cron/
COPY skills/ /opt/codex-workspace/skills/
RUN chmod 0755 /usr/local/bin/codex-workspace-entrypoint \
    && find /opt/codex-workspace/cron -type f -name "*.sh" -exec chmod 0755 {} + \
    && find /opt/codex-workspace/cron -type f -name "*.bb" -exec chmod 0755 {} +

EXPOSE 2222 3456
ENTRYPOINT ["/usr/local/bin/codex-workspace-entrypoint"]
