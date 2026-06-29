FROM ubuntu:26.04@sha256:53958ec7b67c2c9355df922dd08dbf0360611f8c3cdb656875e81873db9ffdba AS builder

ARG LLAMA_REPO=https://github.com/TheTom/llama-cpp-turboquant.git
ARG LLAMA_REF=a33ef00b13476e9c609caecc3c1c015b8615011d
ARG LLAMA_CPU_FLAGS="-march=x86-64-v3 -mavxvnni"

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      git \
      glslang-tools \
      glslc \
      gnupg \
      libvulkan-dev \
      ninja-build \
      pkg-config \
      spirv-headers \
      software-properties-common \
      vulkan-tools \
    && add-apt-repository -y ppa:kobuk-team/intel-graphics \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      clinfo \
      intel-ocloc \
      intel-opencl-icd \
      libshaderc1 \
      libze-intel-gpu1 \
      libze1 \
      mesa-vulkan-drivers \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    git clone --filter=blob:none --no-checkout "${LLAMA_REPO}" /src/llama.cpp; \
    cd /src/llama.cpp; \
    git checkout "${LLAMA_REF}"; \
    git rev-parse HEAD > /opt/llama-source-revision

RUN cmake -S /src/llama.cpp -B /src/llama.cpp/build-vulkan -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_C_FLAGS="${LLAMA_CPU_FLAGS}" \
      -DCMAKE_CXX_FLAGS="${LLAMA_CPU_FLAGS}" \
      -DGGML_NATIVE=OFF \
      -DGGML_AVX_VNNI=ON \
      -DGGML_VULKAN=ON \
      -DGGML_SYCL=OFF \
    && cmake --build /src/llama.cpp/build-vulkan --target llama-server -j"$(nproc)" \
    && install -d -m 0755 /opt/llama.cpp/bin \
    && cp -a /src/llama.cpp/build-vulkan/bin/. /opt/llama.cpp/bin/

FROM ubuntu:26.04@sha256:53958ec7b67c2c9355df922dd08dbf0360611f8c3cdb656875e81873db9ffdba

ARG LLAMA_REPO=https://github.com/TheTom/llama-cpp-turboquant.git
ARG LLAMA_REF=a33ef00b13476e9c609caecc3c1c015b8615011d

LABEL org.opencontainers.image.title="llama-server Vulkan" \
      org.opencontainers.image.description="Intel GPU Vulkan build of llama-server for lolice local LLM workers" \
      org.opencontainers.image.source="${LLAMA_REPO}" \
      org.opencontainers.image.revision="${LLAMA_REF}"

ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/llama.cpp/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg \
      libgomp1 \
      libvulkan1 \
      software-properties-common \
      tini \
      vulkan-tools \
    && add-apt-repository -y ppa:kobuk-team/intel-graphics \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      clinfo \
      intel-ocloc \
      intel-opencl-icd \
      libshaderc1 \
      libze-intel-gpu1 \
      libze1 \
      mesa-vulkan-drivers \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/llama.cpp /opt/llama.cpp
COPY --from=builder /opt/llama-source-revision /opt/llama-source-revision
COPY entrypoint.sh /usr/local/bin/llama-vulkan-entrypoint

RUN echo /opt/llama.cpp/bin > /etc/ld.so.conf.d/llama-vulkan.conf \
    && ldconfig \
    && chmod 0755 /usr/local/bin/llama-vulkan-entrypoint \
    && useradd --create-home --shell /usr/sbin/nologin llama

USER llama
WORKDIR /models
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/llama-vulkan-entrypoint"]
CMD ["llama-server", "--host", "0.0.0.0", "--port", "8080"]
