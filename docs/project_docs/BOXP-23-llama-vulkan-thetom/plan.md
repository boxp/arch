# BOXP-23 llama-server TheTom Vulkan image

## Context

`golyat-4` production currently runs `ghcr.io/boxp/arch/llama-sycl:latest`, but the SYCL/cclecle path has shown unstable behavior around `q8_0` and `turbo3` V cache.

Host smoke on `golyat-4` showed that TheTom `llama-cpp-turboquant` commit `a33ef00b13476e9c609caecc3c1c015b8615011d` can build with `GGML_VULKAN=ON`, detect `Vulkan0: Intel(R) Graphics (ARL)`, and serve a short Gemma4 request with `--cache-type-v turbo3`.

## Plan

1. Publish a separate image, `ghcr.io/boxp/arch/llama-vulkan`, so `argocd-image-updater` cannot accidentally roll a Vulkan-only image under the existing SYCL runtime args.
2. Build the image from TheTom Vulkan:
   - source: `https://github.com/TheTom/llama-cpp-turboquant.git`
   - ref: `a33ef00b13476e9c609caecc3c1c015b8615011d`
   - CMake: `-DGGML_VULKAN=ON`, `-DGGML_SYCL=OFF`
3. Install Vulkan runtime packages in the runtime stage, and remove oneAPI runtime requirements from the image entrypoint path.
4. Validate Dockerfile syntax with BuildKit check before opening the PR.
5. After merge, let the new GitHub Actions workflow push `latest`; `boxp/lolice` should switch the `local-llm` image name and ImageUpdater target in the same PR that switches runtime args to `Vulkan0`.

## Validation

- `docker buildx build --check docker/llama-vulkan`
- GitHub Actions `Build llama-server Vulkan Image`
- Kubernetes `local-llm` rollout after ImageUpdater digest update
