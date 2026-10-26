# Upstream Hermes Agent, pinned by stable tag + multi-arch index digest so Renovate's
# dockerfile manager can follow both the version and the digest (BOXP-313).
# The annotated tag v0.22.5 records this index digest as dockerManifestDigest.
# Do NOT drop the tag (a bare digest cannot be version-looked-up: "Updates: undefined")
# and do NOT move to :latest / :stable (an unpinned moving tag).
FROM docker.io/nousresearch/hermes-agent:v0.22.5@sha256:9c5561579f3ffdf333401797094ac3a743738d6c25d40f4331c7bf77b694238d

ARG OBSIDIAN_HEADLESS_VERSION=0.0.14
ARG BABASHKA_VERSION=1.13.226
ARG BABASHKA_SHA256=bf89e909c4025edf2d669921c81107435b7244840d8f4306f58439c328a342f9

# Keep the upstream PATH order (hermes shim, venv, then the pm-managed node/python
# symlinks under /usr/local/bin) and prepend only the obsidian-headless prefix.
# The venv must come before /usr/local/bin: `python3` there is the bare pm
# interpreter without Hermes' dependencies.
ENV OBSIDIAN_HEADLESS_HOME=/opt/obsidian-headless \
    PATH=/opt/obsidian-headless/bin:/opt/hermes/bin:/opt/hermes/.venv/bin:/opt/data/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# CVE-2026-92392 (HTTP/2 upload use-after-free, BOXP-236) and the eMudhra (emSign)
# intermediate-CA compromise (BOXP-259). The v0.22.5 base (debian:trixie-20261020)
# already ships the fixed curl 8.14.1-2+deb13u7, ca-certificates 20250419+deb13u1 and
# certifi 2026.10.19, so no package is upgraded here any more; the build still FAILS
# if a future base regresses below the fixed versions or re-trusts the revoked roots.
ARG CURL_FIXED_VERSION=8.14.1-2+deb13u7
RUN set -eux; \
    for pkg in curl libcurl4t64 libcurl3t64-gnutls; do \
      dpkg --compare-versions "$(dpkg-query -W -f '${Version}' "$pkg")" ge "${CURL_FIXED_VERSION}"; \
    done; \
    dpkg --compare-versions "$(dpkg-query -W -f '${Version}' ca-certificates)" ge "20250419+deb13u1"; \
    if grep -qE '^mozilla/(emSign_ECC_Root_CA_-_G3|Comodo_AAA_Services_root)\.crt' /etc/ca-certificates.conf; then \
      echo 'emSign ECC Root CA - G3 / Comodo AAA Services root still enabled in ca-certificates.conf' >&2; exit 1; fi; \
    if awk 'BEGIN{c=0} /BEGIN CERT/{c++} {print > ("/tmp/cacheck-" c ".pem")}' /etc/ssl/certs/ca-certificates.crt \
       && for f in /tmp/cacheck-*.pem; do openssl x509 -in "$f" -noout -fingerprint -sha256; done \
          | grep -qiE '86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B|D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4'; then \
      echo 'emSign ECC Root CA - G3 / Comodo AAA Services root still trusted' >&2; exit 1; fi; \
    rm -f /tmp/cacheck-*.pem; \
    /opt/hermes/.venv/bin/python -c "import base64, hashlib, re, certifi; assert tuple(int(p) for p in certifi.__version__.split('.')) >= (2026, 10, 19), certifi.__version__; d = open(certifi.where()).read(); fps = {hashlib.sha256(base64.b64decode(m)).hexdigest().upper() for m in re.findall(r'-----BEGIN CERTIFICATE-----\n(.*?)-----END CERTIFICATE-----', d, re.S)}; assert '86A1ECBA089C4A8D3BBE2734C612BA341D813E043CF9E8A862CD5C57A36BBE6B' not in fps, 'emSign ECC Root CA - G3 still in certifi'; print('certifi', certifi.__version__, 'ok')"

# obsidian-headless CLI (`ob`) for the vault sync sidecar. npm here is the pm-managed
# Node (symlinked into /usr/local/bin by the upstream image).
# better-sqlite3 (obsidian-headless dependency) needs a native binary. npm 12 in the
# v0.22.x base skips dependency install scripts for global installs unless they are
# allowed, so without --allow-scripts the module has no bindings file and `ob sync`
# crash-loops (BOXP-313). Allow its install script (prebuild-install, falling back to
# node-gyp with the base image's gcc/g++/make/python3), rebuild explicitly if that
# still left no binary, and fail the build if the module cannot be loaded.
RUN set -eux; \
    npm_config_prefix="${OBSIDIAN_HEADLESS_HOME}" npm install -g --allow-scripts=better-sqlite3 --foreground-scripts "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}"; \
    pkg="${OBSIDIAN_HEADLESS_HOME}/lib/node_modules/obsidian-headless"; \
    check='const D=require("better-sqlite3"); new D(":memory:").prepare("select 1").get()'; \
    if ! (cd "$pkg" && node -e "$check"); then \
      gyp="$(ls /opt/hermes/tools/node-*/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js | head -1)"; \
      (cd "$pkg/node_modules/better-sqlite3" && node "$gyp" rebuild --release); \
    fi; \
    rm -rf "$pkg/node_modules/better-sqlite3/build/Release/obj" "$pkg/node_modules/better-sqlite3/build/Release/.deps" \
           "$pkg/node_modules/better-sqlite3/build/deps" "$HOME/.cache/node-gyp"; \
    (cd "$pkg" && node -e "$check"); \
    npm cache clean --force; \
    "${OBSIDIAN_HEADLESS_HOME}/bin/ob" --version

RUN set -eux; \
    tmp="$(mktemp -d)"; \
    curl --retry 5 --retry-all-errors --connect-timeout 30 --max-time 300 -fsSL \
      "https://github.com/babashka/babashka/releases/download/v${BABASHKA_VERSION}/babashka-${BABASHKA_VERSION}-linux-amd64-static.tar.gz" \
      -o "$tmp/babashka.tar.gz"; \
    echo "${BABASHKA_SHA256}  $tmp/babashka.tar.gz" | sha256sum -c -; \
    tar -xzf "$tmp/babashka.tar.gz" -C "$tmp" bb; \
    install -m 0755 "$tmp/bb" /usr/local/bin/bb; \
    rm -rf "$tmp"; \
    bb --version

COPY skills/ /opt/boxp/hermes-agent/skills/
COPY patches/ /opt/boxp/hermes-agent/patches/

RUN chmod 0644 /opt/boxp/hermes-agent/skills/obsidian-task-board/SKILL.md \
    && chmod 0755 /opt/boxp/hermes-agent/skills/obsidian-task-board/bin/task-board.bb \
    && chown -R root:root /opt/obsidian-headless /opt/boxp/hermes-agent/skills

# Patch upstream cron/scheduler.py: report ENETUNREACH / Errno 101 as "network
# unreachable" instead of letting the shared error classifier call it a provider
# timeout ("did not respond in time"). Still needed on v0.22.5 (BOXP-137 / BOXP-313).
# The former add-webhook-mirror-to-session.py backport (BOXP-270) is upstream since
# v0.22.x (gateway/platforms/webhook.py ``mirror_to_session``) and was removed.
RUN /opt/hermes/.venv/bin/python /opt/boxp/hermes-agent/patches/fix-scheduler-network-unreachable.py \
    && /opt/hermes/.venv/bin/python -m py_compile /opt/hermes/cron/scheduler.py \
    && grep -q 'mirror_to_session' /opt/hermes/gateway/platforms/webhook.py
