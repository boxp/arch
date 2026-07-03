# Plan: llama SYCL turbo3 SET_ROWS

## Context

`local-llm` on `golyat-4` aborts with Gemma4 and `--cache-type-v turbo3`:

```text
pre-allocated tensor (cache_v_l0 (view)) in a buffer (SYCL0) that cannot run the operation (SET_ROWS)
```

TurboQuant issue TheTom/llama-cpp-turboquant#120 tracks missing SYCL backend coverage for turbo2/turbo3/turbo4 V-cache `SET_ROWS`. The cclecle fork branch linked from that issue contains an unmerged SYCL implementation attempt tested on Intel A380.

## Change

- Pin `docker/llama-sycl` to `cclecle/llama-cpp-turboquant` commit `76d7e0727abd24247bcc8b62b9820e8685efbb7c`.
- Keep `turbo3` support enabled; do not change lolice runtime args to q8/default V-cache.

## Verification

- Run `docker buildx build --check docker/llama-sycl`.
- Build/publish `ghcr.io/boxp/arch/llama-sycl:latest` via GitHub Actions after merge.
- Roll out the refreshed image on `golyat-4`.
- Verify `llama-server` with Gemma4, `--cache-type-v turbo3`, and `/v1/chat/completions`.
