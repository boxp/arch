FROM ubuntu:24.04 AS builder

ARG LLAMA_REPO=https://github.com/TheTom/llama-cpp-turboquant.git
ARG LLAMA_REF=feature/turboquant-kv-cache

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
      -DGGML_SYCL_F16=ON \
      -DCMAKE_C_COMPILER=icx \
      -DCMAKE_CXX_COMPILER=icpx \
    && cmake --build /src/llama.cpp/build-sycl --target llama-ls-sycl-device llama-server -j"$(nproc)" \
    && install -d -m 0755 /opt/llama.cpp/bin \
    && cp -a /src/llama.cpp/build-sycl/bin/. /opt/llama.cpp/bin/

FROM ubuntu:24.04

ARG LLAMA_REPO=https://github.com/TheTom/llama-cpp-turboquant.git
ARG LLAMA_REF=feature/turboquant-kv-cache

LABEL org.opencontainers.image.title="llama-server SYCL" \
      org.opencontainers.image.description="Intel GPU SYCL build of llama-server for lolice local LLM workers" \
      org.opencontainers.image.source="${LLAMA_REPO}" \
      org.opencontainers.image.revision="${LLAMA_REF}"

ENV DEBIAN_FRONTEND=noninteractive \
    ONEAPI_DEVICE_SELECTOR=level_zero:0 \
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

RUN chmod 0755 /usr/local/bin/llama-sycl-entrypoint \
    && useradd --create-home --shell /usr/sbin/nologin llama

USER llama
WORKDIR /models
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/llama-sycl-entrypoint"]
CMD ["llama-server", "--host", "0.0.0.0", "--port", "8080"]
