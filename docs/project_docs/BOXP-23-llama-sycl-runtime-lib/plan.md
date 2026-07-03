# BOXP-23 llama-sycl runtime library path fix

## Context

`ghcr.io/boxp/arch/llama-sycl:latest` published from `boxp/arch#10613`, but the Kubernetes smoke pod failed at startup:

```text
llama-server: error while loading shared libraries: libllama-server-impl.so: cannot open shared object file: No such file or directory
```

The binary and shared library are both copied under `/opt/llama.cpp/bin`, but the runtime linker does not search that directory.

## Plan

1. Add `/opt/llama.cpp/bin` to the runtime image dynamic linker configuration.
2. Run `ldconfig` during image build.
3. Rebuild and publish `ghcr.io/boxp/arch/llama-sycl`.
4. Restart the `local-llm` pod and rerun `/health`, `/v1/models`, and chat completion smoke.

## Validation

- `docker buildx build --check docker/llama-sycl`
- GitHub Actions `Build llama-server SYCL Image`
- Kubernetes `local-llm` rollout on `golyat-4`
