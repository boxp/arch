FROM ubuntu:26.04@sha256:f3d28607ddd78734bb7f71f117f3c6706c666b8b76cbff7c9ff6e5718d46ff64

# Keep pinned versions here covered by renovate.json5 customManagers when adding new tools.
ARG CODEX_VERSION=0.144.4
ARG CLAUDE_CODE_VERSION=2.1.214
ARG EVEN_TERMINAL_VERSION=0.8.1
ARG PI_AGENT_VERSION=0.80.10
ARG OBSIDIAN_HEADLESS_VERSION=0.0.13
ARG GH_VERSION=2.96.0
ARG GHQ_VERSION=1.10.1
ARG GWQ_VERSION=0.1.1
ARG CEEKER_VERSION=0.5.0
ARG BABASHKA_VERSION=1.12.218
ARG LAZYGIT_VERSION=0.63.0
ARG YAZI_VERSION=26.5.6
ARG CURSOR_AGENT_VERSION=2026.06.12-19-59-36-f6aba9a
ARG KUBECTL_VERSION=1.36.2
ARG KUSTOMIZE_VERSION=5.8.1
ARG NODE_MAJOR=24

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash-completion \
      ca-certificates \
      chromium \
      curl \
      fzf \
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
      tini \
      tmux \
      unzip \
      util-linux \
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
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@evenrealities/even-terminal@${EVEN_TERMINAL_VERSION}" \
      "@earendil-works/pi-coding-agent@${PI_AGENT_VERSION}" \
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
    download "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/amd64/kubectl" "$tmp/kubectl"; \
    install -m 0755 "$tmp/kubectl" /usr/local/bin/kubectl; \
    download "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v${KUSTOMIZE_VERSION}/kustomize_v${KUSTOMIZE_VERSION}_linux_amd64.tar.gz" "$tmp/kustomize.tar.gz"; \
    tar -xzf "$tmp/kustomize.tar.gz" -C "$tmp"; \
    install -m 0755 "$tmp/kustomize" /usr/local/bin/kustomize; \
    rm -rf "$tmp"

RUN set -eux; \
    tmp="$(mktemp -d)"; \
    curl --retry 5 --retry-all-errors --connect-timeout 30 --max-time 300 -fsSL \
      "https://downloads.cursor.com/lab/${CURSOR_AGENT_VERSION}/linux/x64/agent-cli-package.tar.gz" \
      -o "$tmp/cursor-agent.tar.gz"; \
    rm -rf /opt/cursor-agent; \
    mkdir -p /opt/cursor-agent; \
    tar --strip-components=1 -xzf "$tmp/cursor-agent.tar.gz" -C /opt/cursor-agent; \
    ln -sf /opt/cursor-agent/cursor-agent /usr/local/bin/cursor-agent; \
    ln -sf /opt/cursor-agent/cursor-agent /usr/local/bin/agent; \
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
    EDITOR=vim \
    VISUAL=vim \
    PATH=/home/boxp/.local/bin:/home/boxp/go/bin:/usr/local/bin:/usr/bin:/bin

COPY entrypoint.sh /usr/local/bin/codex-workspace-entrypoint
COPY dotfiles-sync.sh /opt/codex-workspace/dotfiles-sync.sh
COPY cron/ /opt/codex-workspace/cron/
COPY task-board/ /opt/codex-workspace/task-board/
COPY recurring-events/ /opt/codex-workspace/recurring-events/
COPY skills/ /opt/codex-workspace/skills/
RUN chmod 0755 /usr/local/bin/codex-workspace-entrypoint \
    && chmod 0755 /opt/codex-workspace/dotfiles-sync.sh \
    && find /opt/codex-workspace/cron -type f -name "*.sh" -exec chmod 0755 {} + \
    && find /opt/codex-workspace/cron -type f -name "*.bb" -exec chmod 0755 {} + \
    && find /opt/codex-workspace/task-board -type f -name "*.bb" -exec chmod 0755 {} + \
    && find /opt/codex-workspace/recurring-events -type f -name "*.bb" -exec chmod 0755 {} +

EXPOSE 2222 3456
ENTRYPOINT ["/usr/local/bin/codex-workspace-entrypoint"]
