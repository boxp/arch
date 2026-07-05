# BOXP-23 llama-sycl official llama.cpp build

## Context

`golyat-4` host direct verification showed that official `ggml-org/llama.cpp` commit `8c146a8366304c871efc26057cc90370ccf58dad` builds with oneAPI 2026.0 SYCL and sees the Intel Arc GPU via Level Zero.

The previous `llama-sycl` image defaulted to `cclecle/llama-cpp-turboquant` for experimental TurboQuant SYCL `SET_ROWS` coverage. Current production concerns are output stability and predictable upstream behavior, so the image should default back to official llama.cpp while keeping workflow dispatch override support.

## Plan

1. Change `docker/llama-sycl` defaults to `https://github.com/ggml-org/llama.cpp.git` at verified commit `8c146a8366304c871efc26057cc90370ccf58dad`.
2. Align CMake flags with the successful host direct build: `GGML_SYCL=ON`, `GGML_VULKAN=OFF`, `LLAMA_BUILD_SERVER=ON`, `LLAMA_CURL=OFF`, `GGML_NATIVE=ON`, `icx` / `icpx`.
3. Build only `llama-server` because official HEAD does not require the fork-specific `llama-ls-sycl-device` target for production runtime.
4. Set runtime Level Zero selection explicitly with `ONEAPI_DEVICE_SELECTOR=level_zero:gpu` and `ZE_ENABLE_PCI_ID_DEVICE_ORDER=1`.
5. Publish `ghcr.io/boxp/arch/llama-sycl` from GitHub Actions, then update lolice production manifests to use the new SYCL image and `--device SYCL0`.

## Host Verification

- Host: `golyat-4`, Ubuntu 24.04.4, Intel oneAPI DPC++/C++ Compiler 2026.0.0.
- `sycl-ls` showed `[level_zero:gpu][level_zero:0] Intel(R) Arc(TM) Graphics`.
- `llama-server --list-devices` with `ONEAPI_DEVICE_SELECTOR=level_zero:gpu` showed `SYCL0: Intel(R) Arc(TM) Graphics`.
- Official build completed with commit `8c146a836`.
- Smoke prompt returned valid Japanese text without output corruption.
- Second-run timing after initial SYCL setup: prompt eval `29.11 tok/s`, generation `9.57 tok/s`.
