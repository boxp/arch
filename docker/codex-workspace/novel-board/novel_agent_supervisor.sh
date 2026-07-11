#!/usr/bin/env bash
set -uo pipefail

usage() {
  echo "usage: novel-agent-supervisor --grace-ms N -- command ..." >&2
  exit 64
}

# tini supplies the Linux child-subreaper boundary. This script stays alive as
# its direct child, so orphaned setsid/double-fork descendants are reparented to
# tini and remain visible below TINI_PID in /proc until they have been reaped.
if [[ "${1:-}" != "--internal" ]]; then
  command -v tini >/dev/null 2>&1 || {
    echo "novel-agent-supervisor: tini is required" >&2
    exit 125
  }
  exec tini -s -- "$0" --internal "$@"
fi
shift

[[ "${1:-}" == "--grace-ms" && "${3:-}" == "--" && $# -ge 4 ]] || usage
grace_ms="$2"
shift 3
[[ "${grace_ms}" =~ ^[0-9]+$ && "${grace_ms}" -gt 0 ]] || {
  echo "novel-agent-supervisor: invalid grace period: ${grace_ms}" >&2
  exit 64
}

TINI_PID="${PPID}"
termination_signal=0
phase="running"
deadline_ms=0
main_exited=false
main_status=125
empty_observations=0
declare -a ACTIVE_PIDS=()
declare -A TERM_SIGNALED=()

remember_signal() {
  if [[ "${termination_signal}" -eq 0 ]]; then
    termination_signal="$1"
  fi
}
trap 'remember_signal 15' TERM
trap 'remember_signal 2' INT
trap 'remember_signal 1' HUP

now_ms() {
  date +%s%3N
}

process_is_active() {
  local pid="$1" stat rest state
  [[ -r "/proc/${pid}/stat" ]] || return 1
  IFS= read -r stat <"/proc/${pid}/stat" || return 1
  rest="${stat#*) }"
  state="${rest%% *}"
  [[ "${state}" != "Z" && "${state}" != "X" ]]
}

collect_active_descendants() {
  local root="$1" parent child children_file children_text
  local -a pending=("${root}")
  local -A seen=(["${root}"]=1)
  ACTIVE_PIDS=()

  while ((${#pending[@]} > 0)); do
    parent="${pending[0]}"
    pending=("${pending[@]:1}")
    for children_file in /proc/"${parent}"/task/*/children; do
      [[ -r "${children_file}" ]] || continue
      children_text="$(<"${children_file}")"
      for child in ${children_text}; do
        [[ "${child}" =~ ^[0-9]+$ && "${child}" -gt 1 ]] || continue
        [[ -z "${seen[${child}]:-}" ]] || continue
        seen["${child}"]=1
        pending+=("${child}")
        if [[ "${child}" != "$$" ]] && process_is_active "${child}"; then
          ACTIVE_PIDS+=("${child}")
        fi
      done
    done
  done
}

signal_active() {
  local signal_name="$1" once="$2" index pid
  for ((index=${#ACTIVE_PIDS[@]} - 1; index >= 0; index--)); do
    pid="${ACTIVE_PIDS[index]}"
    if [[ "${once}" == "true" ]]; then
      [[ -z "${TERM_SIGNALED[${pid}]:-}" ]] || continue
      TERM_SIGNALED["${pid}"]=1
    fi
    kill -s "${signal_name}" "${pid}" 2>/dev/null || true
  done
}

# Bash connects an asynchronous command's stdin to /dev/null when job control
# is disabled. Duplicate the runner-provided prompt first so Codex/Claude still
# receive it, while Pi retains the explicit /dev/null supplied by the runner.
exec 3<&0
"$@" <&3 &
main_pid=$!
exec 3<&-

while :; do
  if [[ "${main_exited}" == "false" ]] && ! process_is_active "${main_pid}"; then
    wait "${main_pid}"
    main_status=$?
    main_exited=true
  fi

  current_ms="$(now_ms)"
  if [[ "${termination_signal}" -ne 0 && "${phase}" != "terminating" && "${phase}" != "killing" ]]; then
    phase="terminating"
    deadline_ms=$((current_ms + grace_ms))
  elif [[ "${main_exited}" == "true" && "${phase}" == "running" ]]; then
    phase="natural-grace"
    deadline_ms=$((current_ms + grace_ms))
  fi

  collect_active_descendants "${TINI_PID}"
  if [[ "${phase}" == "natural-grace" && "${current_ms}" -ge "${deadline_ms}" && ${#ACTIVE_PIDS[@]} -gt 0 ]]; then
    phase="terminating"
    deadline_ms=$((current_ms + grace_ms))
  fi
  if [[ "${phase}" == "terminating" ]]; then
    signal_active TERM true
    if [[ "${current_ms}" -ge "${deadline_ms}" ]]; then
      phase="killing"
    fi
  fi
  if [[ "${phase}" == "killing" ]]; then
    signal_active KILL false
  fi

  if [[ "${main_exited}" == "true" && ${#ACTIVE_PIDS[@]} -eq 0 ]]; then
    empty_observations=$((empty_observations + 1))
    if [[ "${empty_observations}" -ge 2 ]]; then
      if [[ "${termination_signal}" -eq 0 ]]; then
        exit "${main_status}"
      fi
      exit $((128 + termination_signal))
    fi
  else
    empty_observations=0
  fi

  sleep 0.02
done
