# Plan: llama-sycl workflow source ref

## Context

The `docker/llama-sycl/Dockerfile` defaults to `cclecle/llama-cpp-turboquant` commit `76d7e0727abd24247bcc8b62b9820e8685efbb7c`, which contains the attempted SYCL `SET_ROWS` support for turboquant V cache.

The GitHub Actions workflow still passed the older `TheTom/llama-cpp-turboquant` branch through build args, so the pushed `latest` image kept `/opt/llama-source-revision` at `a33ef00b13476e9c609caecc3c1c015b8615011d`.

## Change

- Update workflow dispatch defaults and fallback values to the same `cclecle` repo/ref as the Dockerfile.
- Include the workflow file in the push path filter so merging this workflow correction rebuilds `ghcr.io/boxp/arch/llama-sycl`.

## Verification

- Inspect rendered workflow source resolution.
- Run YAML syntax check with Ruby Psych.
- Confirm Git diff has no whitespace errors.
