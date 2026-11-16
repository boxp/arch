#!/usr/bin/env bash
# BOXP-561: GPU 区間の受付操作。deployment の scale は行わない。
# usage: ops.sh preflight | close TOKEN | drain | restore TOKEN PORT | status
set -euo pipefail
NODE=192.168.10.107
RTAPI=/home/boxp/Documents/obsidian-headless/BOXP/Projects/strata-localllm-evaluation/artifacts/boxp383/scripts/rtapi.sh
SVC=http://llama-server.local-llm.svc.cluster.local:8080
log() { echo "$(date -u +%FT%TZ) $*"; }
gate() { kubectl -n local-llm get cm llama-server-admission -o jsonpath='{.data.state}'; }
mem_kb() { ssh -o BatchMode=yes "$NODE" "awk '/MemAvailable/{print \$2}' /proc/meminfo"; }
hangs() { ssh -o BatchMode=yes "$NODE" "sudo -n dmesg | grep -Eic 'GPU HANG|GPU reset' || true"; }
podip() { kubectl -n local-llm get pod -l app=llama-server -o jsonpath='{.items[0].status.podIP}'; }
inflight() { ssh -o BatchMode=yes "$NODE" "curl -s -m 5 http://$(podip):9901/stats" | grep -E 'llama_server.*upstream_rq_(active|pending_active)' | awk '{s+=$2} END{print s+0}'; }
chat() { # URL MODEL -> content|model|tok/s
  curl -s -m "${3:-600}" "$1/v1/chat/completions" -H content-type:application/json \
    -d "{\"model\":\"$2\",\"messages\":[{\"role\":\"user\",\"content\":\"2+3は？数字だけ答えて\"}],\"max_tokens\":8,\"temperature\":0}" |
    jq -r '[(.choices[0].message.content // "ERR"), (.model // "-"), (.timings.predicted_per_second // 0 | tostring)] | join("|")' 2>/dev/null
} # 復帰直後の 503（非 JSON）は空として再試行
case "${1:-}" in
  preflight)
    bad=0
    g=$(gate)
    log "gate=$g"
    [[ $g == open:* ]] || {
      log "NG gate not open"
      bad=1
    }
    sd=$(kubectl -n stable-diffusion get deploy stable-diffusion-webui -o jsonpath='{.spec.replicas}')
    log "sd-webui replicas=$sd (0=llm-open)"
    [[ $sd == 0 ]] || {
      log "NG sd-webui active"
      bad=1
    }
    m=$(mem_kb)
    log "MemAvailable_kB=$m"
    ((m > 40 * 1024 * 1024)) || {
      log "NG MemAvailable < 40GiB"
      bad=1
    }
    log "gpu_hang_reset=$(hangs)"
    log "loaded=$(curl -s -m 10 $SVC/v1/models | jq -r '[.data[]|select(.status.value=="loaded")|.id]|join(",")')"
    log "pods=$(kubectl -n local-llm get pod -l app=llama-server --no-headers | awk '{print $2,$3}' | tr '\n' ';')"
    exit $bad
    ;;
  close)
    tok=${2:?TOKEN}
    bash "$RTAPI" gate "closed:BOXP-561-$tok" 2>&1 | tail -1
    for _ in $(seq 30); do
      c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' $SVC/v1/models || true)
      [[ $c == 503 ]] && break
      sleep 6
    done
    log "gate=$(gate) external_http=$c"
    [[ $c == 503 ]]
    ;;
  drain)
    for _ in $(seq 60); do
      a=$(inflight)
      [[ $a == 0 ]] && break
      sleep 10
    done
    log "inflight=$a"
    [[ $a == 0 ]]
    ;;
  restore)
    tok=${2:?TOKEN}
    port=${3:?PORT}
    r=""
    for _ in $(seq 5); do
      r=$(chat "http://127.0.0.1:$port" gemma4-26b 600 || true)
      [[ $r == 5* ]] && break
      sleep 10
    done
    log "direct gemma4-26b: $r"
    bash "$RTAPI" gate "open:BOXP-561-$tok-end" 2>&1 | tail -1
    for _ in $(seq 30); do
      r2=$(chat $SVC gemma4-26b 120 || true)
      [[ $r2 == 5* ]] && break
      sleep 8
    done
    log "lan gemma4-26b: $r2"
    log "health=$(curl -s -o /dev/null -m 5 -w '%{http_code}' $SVC/health) models=$(curl -s -m 10 $SVC/v1/models | jq '.data|length') gate=$(gate)"
    [[ $r2 == 5* ]]
    ;;
  status) log "gate=$(gate) mem_kB=$(mem_kb) hang=$(hangs) loaded=$(curl -s -m 10 $SVC/v1/models | jq -r '[.data[]|select(.status.value=="loaded")|.id]|join(",")')" ;;
  *)
    echo "usage: ops.sh preflight | close TOKEN | drain | restore TOKEN PORT | status" >&2
    exit 2
    ;;
esac
