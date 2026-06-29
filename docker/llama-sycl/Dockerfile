FROM ubuntu:26.04@sha256:53958ec7b67c2c9355df922dd08dbf0360611f8c3cdb656875e81873db9ffdba AS builder

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp.git
ARG LLAMA_REF=8c146a8366304c871efc26057cc90370ccf58dad

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      git \
      gnupg \
      ninja-build \
      pkg-config \
      software-properties-common \
    && add-apt-repository -y ppa:kobuk-team/intel-graphics \
    && install -d -m 0755 /usr/share/keyrings \
    && curl -fsSL https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB \
      | gpg --dearmor -o /usr/share/keyrings/oneapi-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" \
      > /etc/apt/sources.list.d/oneAPI.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      clinfo \
      intel-ocloc \
      intel-oneapi-compiler-dpcpp-cpp \
      intel-oneapi-mkl-devel \
      intel-opencl-icd \
      libze-dev \
      libze-intel-gpu1 \
      libze1 \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    git clone --filter=blob:none --no-checkout "${LLAMA_REPO}" /src/llama.cpp; \
    cd /src/llama.cpp; \
    git checkout "${LLAMA_REF}"; \
    git rev-parse HEAD > /opt/llama-source-revision

RUN source /opt/intel/oneapi/setvars.sh >/dev/null 2>&1 \
    && cmake -S /src/llama.cpp -B /src/llama.cpp/build-sycl -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DGGML_SYCL=ON \
      -DGGML_VULKAN=OFF \
      -DLLAMA_BUILD_SERVER=ON \
      -DLLAMA_CURL=OFF \
      -DGGML_NATIVE=ON \
      -DCMAKE_C_COMPILER=icx \
      -DCMAKE_CXX_COMPILER=icpx \
    && cmake --build /src/llama.cpp/build-sycl --target llama-server -j"$(nproc)" \
    && install -d -m 0755 /opt/llama.cpp/bin \
    && cp -a /src/llama.cpp/build-sycl/bin/. /opt/llama.cpp/bin/

FROM ubuntu:26.04@sha256:53958ec7b67c2c9355df922dd08dbf0360611f8c3cdb656875e81873db9ffdba

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp.git
ARG LLAMA_REF=8c146a8366304c871efc26057cc90370ccf58dad

LABEL org.opencontainers.image.title="llama-server SYCL" \
      org.opencontainers.image.description="Intel GPU SYCL build of llama-server for lolice local LLM workers" \
      org.opencontainers.image.source="${LLAMA_REPO}" \
      org.opencontainers.image.revision="${LLAMA_REF}"

ENV DEBIAN_FRONTEND=noninteractive \
    ONEAPI_DEVICE_SELECTOR=level_zero:gpu \
    ZE_ENABLE_PCI_ID_DEVICE_ORDER=1 \
    PATH=/opt/llama.cpp/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg \
      libgomp1 \
      software-properties-common \
      tini \
    && add-apt-repository -y ppa:kobuk-team/intel-graphics \
    && install -d -m 0755 /usr/share/keyrings \
    && curl -fsSL https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB \
      | gpg --dearmor -o /usr/share/keyrings/oneapi-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" \
      > /etc/apt/sources.list.d/oneAPI.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      clinfo \
      intel-ocloc \
      intel-oneapi-compiler-dpcpp-cpp-runtime \
      intel-oneapi-mkl-core \
      intel-oneapi-mkl-sycl \
      intel-oneapi-openmp \
      intel-oneapi-tbb \
      intel-opencl-icd \
      libze-intel-gpu1 \
      libze1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/llama.cpp /opt/llama.cpp
COPY --from=builder /opt/llama-source-revision /opt/llama-source-revision
COPY entrypoint.sh /usr/local/bin/llama-sycl-entrypoint

RUN echo /opt/llama.cpp/bin > /etc/ld.so.conf.d/llama-sycl.conf \
    && ldconfig \
    && chmod 0755 /usr/local/bin/llama-sycl-entrypoint \
    && useradd --create-home --shell /usr/sbin/nologin llama

USER llama
WORKDIR /models
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/llama-sycl-entrypoint"]
CMD ["llama-server", "--host", "0.0.0.0", "--port", "8080"]
