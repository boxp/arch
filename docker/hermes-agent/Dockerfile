FROM docker.io/nousresearch/hermes-agent@sha256:94f90d3cb66c848e6d7465fb7ca11dc485f096700edc26f571fedab59f4274f7

ARG OBSIDIAN_HEADLESS_VERSION=0.0.14
ARG BABASHKA_VERSION=1.13.226
ARG BABASHKA_SHA256=bf89e909c4025edf2d669921c81107435b7244840d8f4306f58439c328a342f9

ENV OBSIDIAN_HEADLESS_HOME=/opt/obsidian-headless \
    PATH=/opt/obsidian-headless/bin:/usr/local/bin:/opt/hermes/bin:/opt/hermes/.venv/bin:/opt/data/.local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

# CVE-2026-92392 (HTTP/2 upload use-after-free, BOXP-236): the pinned upstream
# image ships Debian trixie curl 8.14.1-2+deb13u3. Pull only the curl/libcurl
# security update (DSA-6558-1, fixed in 8.14.1-2+deb13u7) from the Debian
# archive and fail the build if the archive did not deliver a fixed version.
ARG CURL_FIXED_VERSION=8.14.1-2+deb13u7
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends --only-upgrade curl libcurl4t64 libcurl3t64-gnutls; \
    rm -rf /var/lib/apt/lists/*; \
    for pkg in curl libcurl4t64 libcurl3t64-gnutls; do \
      dpkg --compare-versions "$(dpkg-query -W -f '${Version}' "$pkg")" ge "${CURL_FIXED_VERSION}"; \
    done

# BOXP-259: eMudhra (emSign) 中間CA秘密鍵侵害への対応。upstream base (Debian trixie) の
# ca-certificates 20250419 と venv の certifi 2026.5.20 は emSign ECC Root CA - G3 を
# まだ信頼しているため、修正版 (Debian 20250419+deb13u1 以降 / certifi 2026.10.19 以降) へ
# 更新し、ビルド時に当該ルートが trust store から外れたことを検証する。
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends --only-upgrade ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    if grep -qE '^mozilla/(emSign_ECC_Root_CA_-_G3|Comodo_AAA_Services_root)\.crt' /etc/ca-certificates.conf; then \
      echo 'emSign ECC Root CA - G3 / Comodo AAA Services root still enabled in ca-certificates.conf' >&2; exit 1; fi; \
    if awk 'BEGIN{c=0} /BEGIN CERT/{c++} {print > ("/tmp/cacheck-" c ".pem")}' /etc/ssl/certs/ca-certificates.crt \
       && for f in /tmp/cacheck-*.pem; do openssl x509 -in "$f" -noout -fingerprint -sha256; done \
          | grep -qiE '86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B|D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4'; then \
      echo 'emSign ECC Root CA - G3 / Comodo AAA Services root still trusted' >&2; exit 1; fi; \
    rm -f /tmp/cacheck-*.pem; \
    uv pip install --python /opt/hermes/.venv/bin/python --no-cache 'certifi>=2026.10.19'; \
    /opt/hermes/.venv/bin/python -c "import base64, hashlib, re, certifi; d = open(certifi.where()).read(); fps = {hashlib.sha256(base64.b64decode(m)).hexdigest().upper() for m in re.findall(r'-----BEGIN CERTIFICATE-----\n(.*?)-----END CERTIFICATE-----', d, re.S)}; assert '86A1ECBA089C4A8D3BBE2734C612BA341D813E043CF9E8A862CD5C57A36BBE6B' not in fps, 'emSign ECC Root CA - G3 still in certifi'; print('certifi', certifi.__version__, 'ok')"

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
COPY patches/ /opt/boxp/hermes-agent/patches/

RUN chmod 0644 /opt/boxp/hermes-agent/skills/obsidian-task-board/SKILL.md \
    && chmod 0755 /opt/boxp/hermes-agent/skills/obsidian-task-board/bin/task-board.bb \
    && chown -R root:root /opt/obsidian-headless /opt/boxp/hermes-agent/skills

# Patch upstream scheduler.py: classify ENETUNREACH / Errno 101 as
# "network unreachable" instead of falling into the generic "timeout" branch.
# Without this, a blocked-IPv6-egress failure is misreported to the operator
# as "provider timeout" (BOXP-137).
RUN python3 /opt/boxp/hermes-agent/patches/fix-scheduler-network-unreachable.py

# Patch upstream gateway/platforms/webhook.py: backport the route option
# ``mirror_to_session`` (upstream main) to v0.18.0 so a webhook delivery to
# Telegram is also appended to that chat's session transcript as a labelled
# user turn, giving follow-up replies the context of what was sent (BOXP-270).
RUN python3 /opt/boxp/hermes-agent/patches/add-webhook-mirror-to-session.py \
    && python3 -m py_compile /opt/hermes/gateway/platforms/webhook.py
