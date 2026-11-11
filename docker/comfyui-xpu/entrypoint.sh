#!/usr/bin/env bash
set -euo pipefail

# Everything ComfyUI writes lives below /data (persistent) or /scratch (temporary);
# the application tree and the virtualenv are read-only for this user.
mkdir -p /data/{input,output,user,custom_nodes} \
  /data/models/{diffusion_models,text_encoders,vae,loras,embeddings,model_patches} \
  /scratch/{tmp,cache,huggingface,temp}

python -c 'import torch
available = torch.xpu.is_available()
message = f"torch={torch.__version__} xpu_available={available}"
if available:
    props = torch.xpu.get_device_properties(0)
    message += f" device={props.name} total_memory={props.total_memory} bytes"
print(message, flush=True)'

# --offline keeps the browser and the server away from the internet and turns
# the paid partner API nodes off. Custom nodes are never loaded, including any
# that a workflow user manages to write below /data/custom_nodes.
exec python main.py --listen 0.0.0.0 --port 8188 --disable-auto-launch \
  --offline --disable-all-custom-nodes \
  --base-directory /data --temp-directory /scratch/temp "$@"
