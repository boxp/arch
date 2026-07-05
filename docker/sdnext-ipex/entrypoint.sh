#!/usr/bin/env bash
set -euo pipefail

mkdir -p \
  /data/models/Stable-diffusion \
  /data/models/Lora \
  /data/models/VAE \
  /data/embeddings \
  /data/extensions \
  /data/outputs \
  /scratch/tmp \
  /scratch/cache \
  /scratch/huggingface

export LD_PRELOAD="${LD_PRELOAD:-libjemalloc.so.2}"
export SD_DATADIR="${SD_DATADIR:-/data}"
export SD_MODELSDIR="${SD_MODELSDIR:-/data/models}"
export TMPDIR="${TMPDIR:-/scratch/tmp}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/scratch/cache}"
export HF_HOME="${HF_HOME:-/scratch/huggingface}"

exec /app/webui.sh -f "$@"

