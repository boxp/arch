FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55

ARG SDNEXT_REPO=https://github.com/vladmandic/sdnext.git
ARG SDNEXT_REF=b7dcb0ce870181a40d1246fde1febbff5593a750

LABEL org.opencontainers.image.title="SD.Next IPEX" \
      org.opencontainers.image.description="SD.Next Intel IPEX image for lolice stable-diffusion WebUI" \
      org.opencontainers.image.source="${SDNEXT_REPO}" \
      org.opencontainers.image.revision="${SDNEXT_REF}"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=true \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    UV_NO_CACHE=true \
    SD_DOCKER=true \
    SD_DATADIR=/data \
    SD_MODELSDIR=/data/models \
    venv_dir=/opt/sdnext/venv \
    IPEXRUN=False

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing \
      build-essential \
      ca-certificates \
      curl \
      git \
      gpg \
      libgl1 \
      libglib2.0-0 \
      libgomp1 \
      libjemalloc-dev \
      python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      software-properties-common \
      tini \
      wget \
    && python3 -m pip install --no-cache-dir uv \
    && wget -qO - https://repositories.intel.com/gpu/intel-graphics.key \
      | gpg --yes --dearmor --output /usr/share/keyrings/intel-graphics.gpg \
    && echo "deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu noble client" \
      > /etc/apt/sources.list.d/intel-gpu-noble.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing \
      intel-opencl-icd \
      libze-intel-gpu1 \
      libze1 \
    && ldconfig \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    git clone --filter=blob:none --no-checkout "${SDNEXT_REPO}" /app; \
    cd /app; \
    git checkout "${SDNEXT_REF}"; \
    git rev-parse HEAD > /opt/sdnext-source-revision

COPY entrypoint.sh /usr/local/bin/sdnext-ipex-entrypoint

RUN chmod 0755 /usr/local/bin/sdnext-ipex-entrypoint \
    && mkdir -p /data /scratch/tmp /scratch/cache /scratch/huggingface /opt/sdnext \
    && chmod 0775 /data /scratch /scratch/tmp /scratch/cache /scratch/huggingface /opt/sdnext

ENV HF_HOME=/scratch/huggingface \
    XDG_CACHE_HOME=/scratch/cache \
    TMPDIR=/scratch/tmp

WORKDIR /app

RUN set -eux; \
    . /etc/os-release; \
    test "$VERSION_CODENAME" = noble; \
    python3 -c 'import sys; assert sys.version_info[:2] == (3, 12)'; \
    python3 --version; \
    dpkg-query -W curl libcurl4t64; \
    python3 -m venv "${venv_dir}"; \
    "${venv_dir}/bin/python" -m pip install --no-cache-dir uv; \
    uv pip install --python "${venv_dir}/bin/python" \
      torch==2.12.0+xpu \
      torchvision==0.27.0+xpu \
      --extra-index-url https://download.pytorch.org/whl/xpu; \
    set +e; \
    /app/webui.sh -f \
      --use-ipex \
      --uv \
      --skip-git \
      --skip-extensions \
      --skip-torch \
      --test \
      --log /tmp/sdnext-build.log; \
    status="$?"; \
    set -e; \
    test "$status" -eq 0 -o "$status" -eq 139; \
    grep -q 'Installer time:' /tmp/sdnext-build.log; \
    ! grep -q 'Setup complete with errors' /tmp/sdnext-build.log; \
    rm -rf \
      /tmp/sdnext-build.log \
      /app/sdnext.log \
      /app/pip.log \
      /scratch/tmp/* \
      /scratch/cache/* \
      /scratch/huggingface/*

# webui.sh runs with --skip-git/--skip-extensions above, so initialize only the
# mandatory sdnq gitlink afterwards without invalidating its expensive layer.
RUN set -eux; \
    sdnext_commit="$(git -C /app rev-parse "${SDNEXT_REF}^{commit}")"; \
    test "$(git -C /app rev-parse HEAD)" = "${sdnext_commit}"; \
    sdnq_target="$(git -C /app ls-tree "${sdnext_commit}" -- extensions-builtin/sdnq | awk '$1 == "160000" && $2 == "commit" { print $3 }')"; \
    test -n "${sdnq_target}"; \
    git -C /app submodule update --init --checkout --depth 1 -- extensions-builtin/sdnq; \
    test "$(git -C /app/extensions-builtin/sdnq rev-parse HEAD)" = "${sdnq_target}"; \
    test -f /app/extensions-builtin/sdnq/src/sdnq/__init__.py

EXPOSE 7860
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sdnext-ipex-entrypoint"]
CMD ["--use-ipex", "--listen", "--server-name", "0.0.0.0", "--port", "7860", "--skip-git", "--skip-requirements", "--skip-extensions", "--skip-torch", "--log", "/scratch/sdnext.log"]
