# BOXP-23 llama-vulkan AVX_VNNI plan

## Goal

Run the production `local-llm` `llama-server` container with AVX_VNNI enabled on `golyat-4`.

## Background

Host-direct `llama-server` built on `golyat-4` reports `AVX_VNNI = 1` and improves Gemma4 short prompt eval from about `4.25 tok/s` in the production Pod to about `10.31 tok/s`. The production container can see `avx_vnni` in `/proc/cpuinfo`, but the `llama-server` runtime log does not report `AVX_VNNI`.

## Plan

1. Update `docker/llama-vulkan` to compile `llama-server` with explicit x86 CPU flags that enable AVX_VNNI without relying on the GitHub Actions runner CPU.
   - Use `GGML_NATIVE=OFF` so llama.cpp does not add `-march=native` for the runner.
   - Use `GGML_AVX_VNNI=ON` because this llama.cpp fork keeps AVX_VNNI behind an explicit CMake option.
   - Use explicit flags such as `-march=x86-64-v3 -mavxvnni`.
2. Keep the existing TheTom TurboQuant source ref and Vulkan backend.
3. Validate Dockerfile syntax/build metadata locally.
4. Merge the image build change and let the main workflow publish `ghcr.io/boxp/arch/llama-vulkan`.
5. Let `argocd-image-updater` pin the new digest in `boxp/lolice`, then verify the production Pod reports `AVX_VNNI = 1`.
6. Re-run the same Gemma4 short Japanese smoke and compare prompt/generation token rates against the host-direct baseline.

## Validation

- `docker buildx build --check docker/llama-vulkan`
- GitHub Actions image build succeeds on main.
- Production `local-llm` Pod runs the new digest.
- `llama-server` child process logs include `AVX_VNNI = 1`.
- Gemma4 short Japanese prompt returns normal Japanese and improved prompt eval token/s.
