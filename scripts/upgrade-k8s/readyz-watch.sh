#!/usr/bin/env bash
# readyz-watch.sh — BOXP-213 (BOXP-194 A2 / H2)
#
# Records kube-apiserver /readyz for the VIP and each control plane every
# --interval seconds from a GitHub-hosted runner, and HALTs when API
# redundancy is lost for --halt-after seconds:
#
#   tick is "bad" when  VIP readyz failed
#                   OR  >= 2 control planes other than --updating-node failed
#   HALT             when consecutive bad ticks span >= --halt-after seconds
#
# Transient failures (recover before --halt-after) are recorded but never halt.
# Probes run over SSH from a non-updating control plane (the runner cannot reach
# the node network directly). If no probe host is reachable the tick counts as
# failed for every target (safe side).
#
# Artifacts written to --out-dir (no IPs, hostnames, credentials):
#   readyz-samples.jsonl  one line per target per tick
#   readyz-events.jsonl   state transitions (bad_start / recovered / halt / stop)
#   readyz-summary.json   verdict + counters (rewritten every tick)
#   HALT                  marker file, only when the verdict is halt
#
# Exit codes: 0 = finished without halt, 2 = HALT, 64 = usage error.
#
# Test hooks (environment):
#   READYZ_PROBE_CMD  <cmd> <probe_host> <ip>...  -> prints "<ip> <http_code>" per line
#   READYZ_NOW_CMD    <cmd>                       -> prints epoch seconds
#   READYZ_SLEEP_CMD  <cmd> <seconds>
# Runtime hooks (environment):
#   READYZ_SSH_HOST_PREFIX  prefix added to the probe-host name to form the ssh Host alias
#                           (the workflow registers "readyz-<cp>" aliases)
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: readyz-watch.sh --vip NAME=IP --cp NAME=IP [--cp NAME=IP ...] --out-dir DIR
                       [--updating-node NAME] [--interval SEC] [--halt-after SEC]
                       [--duration SEC] [--stop-file PATH] [--port PORT]
USAGE
  exit 64
}

VIP_NAME=""
VIP_IP=""
CP_NAMES=()
CP_IPS=()
OUT_DIR=""
UPDATING_NODE=""
INTERVAL=30
HALT_AFTER=180
DURATION=0
STOP_FILE=""
PORT=6443

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vip) [[ $# -ge 2 ]] || usage; VIP_NAME="${2%%=*}"; VIP_IP="${2#*=}"; shift 2 ;;
    --cp) [[ $# -ge 2 ]] || usage; CP_NAMES+=("${2%%=*}"); CP_IPS+=("${2#*=}"); shift 2 ;;
    --out-dir) [[ $# -ge 2 ]] || usage; OUT_DIR="$2"; shift 2 ;;
    --updating-node) [[ $# -ge 2 ]] || usage; UPDATING_NODE="$2"; shift 2 ;;
    --interval) [[ $# -ge 2 ]] || usage; INTERVAL="$2"; shift 2 ;;
    --halt-after) [[ $# -ge 2 ]] || usage; HALT_AFTER="$2"; shift 2 ;;
    --duration) [[ $# -ge 2 ]] || usage; DURATION="$2"; shift 2 ;;
    --stop-file) [[ $# -ge 2 ]] || usage; STOP_FILE="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || usage; PORT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "readyz-watch: unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$VIP_NAME" && -n "$VIP_IP" && "$VIP_NAME" != "$VIP_IP" ]] || { echo "readyz-watch: --vip NAME=IP is required" >&2; usage; }
[[ ${#CP_NAMES[@]} -ge 1 ]] || { echo "readyz-watch: at least one --cp NAME=IP is required" >&2; usage; }
[[ -n "$OUT_DIR" ]] || { echo "readyz-watch: --out-dir is required" >&2; usage; }
for v in INTERVAL HALT_AFTER DURATION PORT; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || { echo "readyz-watch: --${v,,} must be a non-negative integer" >&2; usage; }
  # Force base-10 so a leading zero (e.g. "0180") is not read as octal by $(( )) / [[ -gt ]].
  printf -v "$v" '%d' "$((10#${!v}))"
done
[[ "$DURATION" -gt 0 || -n "$STOP_FILE" ]] || { echo "readyz-watch: --duration or --stop-file is required" >&2; usage; }
command -v jq >/dev/null 2>&1 || { echo "readyz-watch: jq is required" >&2; exit 64; }

mkdir -p "$OUT_DIR"
SAMPLES="$OUT_DIR/readyz-samples.jsonl"
EVENTS="$OUT_DIR/readyz-events.jsonl"
SUMMARY="$OUT_DIR/readyz-summary.json"
HALT_MARKER="$OUT_DIR/HALT"
: >"$SAMPLES"
: >"$EVENTS"
rm -f "$HALT_MARKER"

now() {
  if [[ -n "${READYZ_NOW_CMD:-}" ]]; then "$READYZ_NOW_CMD"; else date +%s; fi
}
iso() { date -u -d "@$1" +%FT%TZ; }
do_sleep() {
  if [[ -n "${READYZ_SLEEP_CMD:-}" ]]; then "$READYZ_SLEEP_CMD" "$1"; else sleep "$1"; fi
}

# Default probe: one SSH session to the probe host, curl every target from there.
default_probe() {
  local host="$1"
  shift
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 \
    "${READYZ_SSH_HOST_PREFIX:-}${host}" "bash -s -- $PORT $*" <<'REMOTE'
port="$1"; shift
for ip in "$@"; do
  code="$(curl -sk --max-time 5 -o /dev/null -w '%{http_code}' "https://${ip}:${port}/readyz" 2>/dev/null || true)"
  printf '%s %s\n' "$ip" "${code:-000}"
done
REMOTE
}
run_probe() {
  if [[ -n "${READYZ_PROBE_CMD:-}" ]]; then "$READYZ_PROBE_CMD" "$@"; else default_probe "$@"; fi
}

log() { printf '%s readyz-watch: %s\n' "$(iso "$(now)")" "$*"; }

emit_event() {
  local epoch="$1" type="$2" detail="$3"
  jq -nc --arg ts "$(iso "$epoch")" --argjson epoch "$epoch" --arg type "$type" --arg detail "$detail" \
    '{ts:$ts, epoch:$epoch, type:$type, detail:$detail}' >>"$EVENTS"
}

STARTED_AT="$(now)"
TICKS=0
SAMPLE_COUNT=0
BAD_SINCE=""
BAD_REASON=""
TRANSIENT_EPISODES=0
LONGEST_BAD=0
VERDICT="running"
STOP_REASON=""
HALT_AT=""
LAST_PROBE_HOST=""

write_summary() {
  local ended="$1"
  jq -n \
    --arg verdict "$VERDICT" \
    --arg stop_reason "$STOP_REASON" \
    --arg halt_reason "$BAD_REASON" \
    --arg started_at "$(iso "$STARTED_AT")" \
    --arg ended_at "$(iso "$ended")" \
    --arg updating_node "$UPDATING_NODE" \
    --arg vip "$VIP_NAME" \
    --argjson cps "$(printf '%s\n' "${CP_NAMES[@]}" | jq -R . | jq -sc .)" \
    --argjson interval "$INTERVAL" \
    --argjson halt_after "$HALT_AFTER" \
    --argjson duration "$DURATION" \
    --argjson ticks "$TICKS" \
    --argjson samples "$SAMPLE_COUNT" \
    --argjson transient_episodes "$TRANSIENT_EPISODES" \
    --argjson longest_bad_seconds "$LONGEST_BAD" \
    --arg bad_since "${BAD_SINCE:+$(iso "$BAD_SINCE")}" \
    --arg halt_at "${HALT_AT:+$(iso "$HALT_AT")}" \
    '{verdict:$verdict, stop_reason:$stop_reason, halt_reason:(if $verdict=="halt" then $halt_reason else "" end),
      started_at:$started_at, ended_at:$ended_at, updating_node:$updating_node,
      targets:{vip:$vip, control_planes:$cps},
      interval_seconds:$interval, halt_after_seconds:$halt_after, duration_seconds:$duration,
      ticks:$ticks, samples:$samples, transient_episodes:$transient_episodes,
      longest_bad_seconds:$longest_bad_seconds,
      bad_since:(if $bad_since=="" then null else $bad_since end),
      halt_at:(if $halt_at=="" then null else $halt_at end)}' >"$SUMMARY"
}

record_sample() {
  local epoch="$1" name="$2" kind="$3" code="$4" ok="$5" probe_host="$6" error="$7" excluded="$8"
  jq -nc --arg ts "$(iso "$epoch")" --argjson epoch "$epoch" --argjson tick "$TICKS" \
    --arg target "$name" --arg kind "$kind" --arg code "$code" --argjson ok "$ok" \
    --arg probe_host "$probe_host" --arg error "$error" --argjson excluded "$excluded" \
    '{ts:$ts, epoch:$epoch, tick:$tick, target:$target, kind:$kind, http_code:$code, ok:$ok,
      probe_host:(if $probe_host=="" then null else $probe_host end),
      error:(if $error=="" then null else $error end), excluded:$excluded}' >>"$SAMPLES"
  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
}

# Probe-host candidates: control planes other than the updating node.
PROBE_CANDIDATES=()
for name in "${CP_NAMES[@]}"; do
  [[ "$name" == "$UPDATING_NODE" ]] || PROBE_CANDIDATES+=("$name")
done
[[ ${#PROBE_CANDIDATES[@]} -ge 1 ]] || { echo "readyz-watch: no probe-host candidate (all control planes excluded)" >&2; exit 64; }

ALL_IPS=("$VIP_IP" "${CP_IPS[@]}")

log "start vip=${VIP_NAME} cps=${CP_NAMES[*]} updating=${UPDATING_NODE:-none} interval=${INTERVAL}s halt_after=${HALT_AFTER}s duration=${DURATION:-0}s"
emit_event "$STARTED_AT" start "updating=${UPDATING_NODE:-none}"
write_summary "$STARTED_AT"

while :; do
  TICK_START="$(now)"
  if [[ -n "$STOP_FILE" && -e "$STOP_FILE" ]]; then
    STOP_REASON="stop_file"
    break
  fi
  if [[ "$DURATION" -gt 0 && $((TICK_START - STARTED_AT)) -ge "$DURATION" ]]; then
    STOP_REASON="duration"
    break
  fi
  TICKS=$((TICKS + 1))

  # Choose a probe host (sticky: last good host first).
  ordered=()
  [[ -n "$LAST_PROBE_HOST" ]] && ordered+=("$LAST_PROBE_HOST")
  for c in "${PROBE_CANDIDATES[@]}"; do
    [[ "$c" == "$LAST_PROBE_HOST" ]] || ordered+=("$c")
  done
  PROBE_HOST=""
  PROBE_OUTPUT=""
  for c in "${ordered[@]}"; do
    if PROBE_OUTPUT="$(run_probe "$c" "${ALL_IPS[@]}" 2>/dev/null)"; then
      PROBE_HOST="$c"
      LAST_PROBE_HOST="$c"
      break
    fi
    log "probe host ${c} unreachable"
  done

  # Parse results into code_for[ip].
  declare -A code_for=()
  if [[ -n "$PROBE_HOST" ]]; then
    while read -r ip code; do
      [[ -n "$ip" ]] && code_for["$ip"]="${code:-000}"
    done <<<"$PROBE_OUTPUT"
  fi

  vip_ok=false
  failed_cps=()
  idx=0
  for ip in "${ALL_IPS[@]}"; do
    if [[ $idx -eq 0 ]]; then name="$VIP_NAME"; kind="vip"; else name="${CP_NAMES[$((idx - 1))]}"; kind="cp"; fi
    excluded=false
    [[ "$kind" == "cp" && "$name" == "$UPDATING_NODE" ]] && excluded=true
    error=""
    if [[ -z "$PROBE_HOST" ]]; then
      code="000"; error="probe_unreachable"
    else
      code="${code_for[$ip]:-000}"
      [[ "$code" =~ ^[0-9]{3}$ ]] || { code="000"; error="probe_parse_error"; }
    fi
    ok=false
    [[ "$code" == "200" ]] && ok=true
    record_sample "$TICK_START" "$name" "$kind" "$code" "$ok" "$PROBE_HOST" "$error" "$excluded"
    if [[ "$kind" == "vip" ]]; then
      vip_ok="$ok"
    elif [[ "$ok" == false && "$excluded" == false ]]; then
      failed_cps+=("$name")
    fi
    idx=$((idx + 1))
  done
  unset code_for

  reason=""
  [[ "$vip_ok" == false ]] && reason="vip_readyz_failed"
  if [[ ${#failed_cps[@]} -ge 2 ]]; then
    reason="${reason:+${reason}+}cp_readyz_failed(${failed_cps[*]})"
  fi

  if [[ -n "$reason" ]]; then
    if [[ -z "$BAD_SINCE" ]]; then
      BAD_SINCE="$TICK_START"
      emit_event "$TICK_START" bad_start "$reason"
      log "redundancy loss started: ${reason}"
    fi
    BAD_REASON="$reason"
    elapsed=$((TICK_START - BAD_SINCE))
    [[ "$elapsed" -gt "$LONGEST_BAD" ]] && LONGEST_BAD="$elapsed"
    log "tick ${TICKS}: BAD (${reason}) for ${elapsed}s / ${HALT_AFTER}s"
    if [[ "$elapsed" -ge "$HALT_AFTER" ]]; then
      VERDICT="halt"
      STOP_REASON="halt"
      HALT_AT="$TICK_START"
      emit_event "$TICK_START" halt "${reason} sustained ${elapsed}s"
      printf 'HALT %s %s\n' "$(iso "$TICK_START")" "$reason" >"$HALT_MARKER"
      write_summary "$TICK_START"
      log "HALT: ${reason} sustained for ${elapsed}s (>= ${HALT_AFTER}s). Do not dispatch the next node."
      exit 2
    fi
  else
    if [[ -n "$BAD_SINCE" ]]; then
      elapsed=$((TICK_START - BAD_SINCE))
      TRANSIENT_EPISODES=$((TRANSIENT_EPISODES + 1))
      emit_event "$TICK_START" recovered "${BAD_REASON} lasted ${elapsed}s"
      log "recovered after ${elapsed}s (transient, no halt)"
      BAD_SINCE=""
      BAD_REASON=""
    fi
    log "tick ${TICKS}: ok (probe_host=${PROBE_HOST})"
  fi
  write_summary "$TICK_START"

  if [[ "$INTERVAL" -gt 0 ]]; then
    do_sleep "$INTERVAL"
  fi
done

END_AT="$(now)"
VERDICT="ok"
if [[ -n "$BAD_SINCE" ]]; then
  # Still inside a failure episode shorter than --halt-after when we were told to stop.
  elapsed=$((END_AT - BAD_SINCE))
  emit_event "$END_AT" stop "${STOP_REASON} (unresolved ${BAD_REASON} for ${elapsed}s < ${HALT_AFTER}s)"
  log "stop (${STOP_REASON}) while ${BAD_REASON} ongoing for ${elapsed}s (< ${HALT_AFTER}s): no halt"
else
  emit_event "$END_AT" stop "$STOP_REASON"
fi
write_summary "$END_AT"
log "finished: verdict=ok ticks=${TICKS} samples=${SAMPLE_COUNT} transient_episodes=${TRANSIENT_EPISODES} longest_bad=${LONGEST_BAD}s"
exit 0
