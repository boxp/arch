FROM ubuntu:noble@sha256:9cbed754112939e914291337b5e554b07ad7c392491dba6daf25eef1332a22e8

ARG SDNEXT_REPO=https://github.com/vladmandic/sdnext.git
ARG SDNEXT_REF=master

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

EXPOSE 7860
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sdnext-ipex-entrypoint"]
CMD ["--use-ipex", "--listen", "--server-name", "0.0.0.0", "--port", "7860", "--skip-git", "--skip-requirements", "--skip-extensions", "--skip-torch", "--log", "/scratch/sdnext.log"]
