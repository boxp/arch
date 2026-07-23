FROM docker.io/nousresearch/hermes-agent@sha256:94f90d3cb66c848e6d7465fb7ca11dc485f096700edc26f571fedab59f4274f7

ARG OBSIDIAN_HEADLESS_VERSION=0.0.13
ARG BABASHKA_VERSION=1.12.218
ARG BABASHKA_SHA256=7bd028cc794732ffde3da31ce4379840893c8e54f1046f92a8dfc4f4b3cddaf8

ENV OBSIDIAN_HEADLESS_HOME=/opt/obsidian-headless \
    PATH=/opt/obsidian-headless/bin:/usr/local/bin:/opt/hermes/bin:/opt/hermes/.venv/bin:/opt/data/.local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

RUN npm_config_prefix="${OBSIDIAN_HEADLESS_HOME}" npm install -g "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}" \
    && npm cache clean --force

RUN set -eux; \
    tmp="$(mktemp -d)"; \
    curl --retry 5 --retry-all-errors --connect-timeout 30 --max-time 300 -fsSL \
      "https://github.com/babashka/babashka/releases/download/v${BABASHKA_VERSION}/babashka-${BABASHKA_VERSION}-linux-amd64-static.tar.gz" \
      -o "$tmp/babashka.tar.gz"; \
    echo "${BABASHKA_SHA256}  $tmp/babashka.tar.gz" | sha256sum -c -; \
    tar -xzf "$tmp/babashka.tar.gz" -C "$tmp" bb; \
    install -m 0755 "$tmp/bb" /usr/local/bin/bb; \
    rm -rf "$tmp"

COPY skills/ /opt/boxp/hermes-agent/skills/

RUN chmod 0644 /opt/boxp/hermes-agent/skills/obsidian-task-board/SKILL.md \
    && chmod 0755 /opt/boxp/hermes-agent/skills/obsidian-task-board/bin/task-board.bb \
    && chown -R root:root /opt/obsidian-headless /opt/boxp/hermes-agent/skills
