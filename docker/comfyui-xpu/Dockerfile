FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c

ARG COMFYUI_REPO=https://github.com/comfyanonymous/ComfyUI.git
# renovate: datasource=github-releases depName=comfyanonymous/ComfyUI
ARG COMFYUI_REF=v0.45.0

LABEL org.opencontainers.image.title="ComfyUI XPU" \
      org.opencontainers.image.description="ComfyUI native PyTorch XPU image for Intel GPUs" \
      org.opencontainers.image.source="${COMFYUI_REPO}" \
      org.opencontainers.image.revision="${COMFYUI_REF}"

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HOME=/scratch/huggingface \
    XDG_CACHE_HOME=/scratch/cache \
    TMPDIR=/scratch/tmp \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HUB_OFFLINE=1 \
    PATH=/opt/comfyui/venv/bin:$PATH

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN mkdir -p /scratch/tmp \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing \
      ca-certificates git gpg libgl1 libglib2.0-0 python3 python3-venv tini wget \
    && wget -qO - https://repositories.intel.com/gpu/intel-graphics.key \
      | gpg --yes --dearmor --output /usr/share/keyrings/intel-graphics.gpg \
    && echo "deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu noble client" \
      > /etc/apt/sources.list.d/intel-gpu-noble.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing intel-opencl-icd libze-intel-gpu1 libze1 \
    && ldconfig \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --filter=blob:none --no-checkout "${COMFYUI_REPO}" /app \
    && cd /app \
    && git checkout "${COMFYUI_REF}" \
    && git rev-parse HEAD > /opt/comfyui-source-revision

WORKDIR /app

RUN python3 -m venv /opt/comfyui/venv \
    && printf '%s\n' 'torch==2.12.0+xpu' 'torchvision==0.27.0+xpu' > /tmp/constraints.txt \
    && python -m pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/xpu -r /tmp/constraints.txt \
    && python -m pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/xpu -c /tmp/constraints.txt -r requirements.txt \
    && python -c 'import torch, torchvision, av; assert torch.__version__.startswith("2.12.0+xpu")' \
    && grep -q 'class MiniMaxH3ImageToVideo' /app/comfy_extras/nodes_minimax_h3.py \
    && mkdir -p /scratch/tmp /scratch/cache /scratch/huggingface /scratch/temp /data \
    # The builder has no GPU, and enumerating Level Zero without one crashes;
    # the selector keeps the SYCL runtime away from it for this start-up test only.
    && ONEAPI_DEVICE_SELECTOR=opencl:cpu python main.py --quick-test-for-ci --cpu --offline --disable-all-custom-nodes --base-directory /data --temp-directory /scratch/temp \
    && rm -rf /data \
    && mkdir -p /data \
    && rm -f /tmp/constraints.txt \
    && rm -rf /scratch/tmp/* /scratch/cache/* /scratch/huggingface/* /scratch/temp/* \
    && chown -R root:root /app /opt/comfyui/venv \
    && chmod -R a-w /app /opt/comfyui/venv \
    && chown -R 1000:1000 /data /scratch

COPY entrypoint.sh /usr/local/bin/comfyui-xpu-entrypoint
RUN chmod 0755 /usr/local/bin/comfyui-xpu-entrypoint

USER 1000:1000
EXPOSE 8188
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/comfyui-xpu-entrypoint"]
