# BOXP-23 llama-server SYCL image plan

## Context

`golyat-4` の Intel Arc GPU では CUDA build は使えない。Host smoke では upstream `llama.cpp` の SYCL backend が動くことを確認済みだが、lolice の local LLM workload では Ooedo と同じ `TheTom/llama-cpp-turboquant` `feature/turboquant-kv-cache` を優先する。

## Plan

1. `boxp/arch` で `ghcr.io/boxp/arch/llama-sycl` を build / publish する。
2. Dockerfile の default source は `https://github.com/TheTom/llama-cpp-turboquant.git` / `feature/turboquant-kv-cache` にする。
3. `workflow_dispatch` では `llama_repo` / `llama_ref` を override できるようにして、upstream `ggml-org/llama.cpp` での切り分けも可能にする。
4. Image には Ubuntu 24.04、Intel graphics PPA runtime、Intel oneAPI runtime、`llama-server` / `llama-ls-sycl-device` を含める。
5. `boxp/lolice` 側の Kubernetes manifest は、この GHCR image を使い、`gpu.intel.com/i915: 1` request、`lolice.io/gpu-worker=true` selector、GPU worker taint toleration を設定する。

## Verification

- PR build: Docker image build completes without push.
- Main build: GHCR に timestamp / `sha-*` / `latest` tag を publish。
- Runtime smoke: `golyat-4` 上の Kubernetes Pod で `llama-server --list-devices` が `SYCL0: Intel(R) Arc(TM) Graphics` を返す。
- Model smoke: small GGUF で `/health` と `/v1/chat/completions` が通る。
