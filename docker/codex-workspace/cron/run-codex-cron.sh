#!/usr/bin/env bash
set -Eeuo pipefail

job_id="${1:-${CODEX_CRON_JOB_ID:-}}"
if [[ -z "${job_id}" ]]; then
  echo "usage: run-codex-cron.sh <job-id>" >&2
  exit 2
fi

cron_root="${CODEX_CRON_ROOT:-/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron}"
selector="${CODEX_CRON_SELECTOR:-/opt/codex-workspace/cron/select-codex-cron-job.bb}"

eval "$(
  bb "${selector}" "${job_id}"
)"

job_name="${CODEX_CRON_NAME:-${job_id}}"
prompt_file="${CODEX_CRON_PROMPT_FILE:?CODEX_CRON_PROMPT_FILE is required}"
workdir="${CODEX_CRON_WORKDIR:-/home/boxp}"
output_root="${CODEX_CRON_OUTPUT_ROOT:-${cron_root}/runs}"
lock_root="${CODEX_CRON_LOCK_ROOT:-${cron_root}/locks}"
runner="${CODEX_CRON_RUNNER:-codex}"
run_id="${CODEX_CRON_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
run_dir="${output_root}/${job_id}/${run_id}"
lock_dir="${lock_root}/${job_id}.lock"

mkdir -p "${run_dir}" "${lock_root}"

if ! mkdir "${lock_dir}" 2>/dev/null; then
  lock_stale_seconds="${CODEX_CRON_LOCK_STALE_SECONDS:-43200}"
  lock_mtime="$(stat -c %Y "${lock_dir}" 2>/dev/null || echo 0)"
  now_epoch="$(date -u +%s)"
  if (( now_epoch - lock_mtime > lock_stale_seconds )); then
    echo "removing stale codex cron lock: ${lock_dir}" >&2
    rm -rf "${lock_dir}"
    mkdir "${lock_dir}"
  else
    echo "codex cron job '${job_name}' is already running: ${lock_dir}" >&2
    exit 75
  fi
fi

cleanup() {
  rmdir "${lock_dir}" 2>/dev/null || true
}
trap cleanup EXIT

runner="$(printf '%s' "${runner}" | tr '[:upper:]' '[:lower:]')"
case "${runner}" in
  codex | cursor) ;;
  *)
    echo "unsupported codex cron runner '${runner}' for job '${job_name}'" >&2
    exit 2
    ;;
esac

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "${runner}" == "cursor" ]]; then
  stdout_log="${run_dir}/stdout.log"
else
  stdout_log="${run_dir}/events.jsonl"
fi
stderr_log="${run_dir}/stderr.log"
last_message="${run_dir}/last-message.md"
summary_file="${run_dir}/summary.edn"

args=()

if [[ "${runner}" == "codex" ]]; then
  args=(exec --json --cd "${workdir}" --output-last-message "${last_message}")

  if [[ "${CODEX_CRON_BYPASS_APPROVALS:-true}" == "true" ]]; then
    args+=(--dangerously-bypass-approvals-and-sandbox)
  else
    args+=(--sandbox "${CODEX_CRON_SANDBOX:-workspace-write}")
  fi

  if [[ -n "${CODEX_CRON_MODEL:-}" ]]; then
    args+=(--model "${CODEX_CRON_MODEL}")
  fi

  if [[ -n "${CODEX_CRON_PROFILE:-}" ]]; then
    args+=(--profile "${CODEX_CRON_PROFILE}")
  fi
else
  args=(--print --output-format text --trust --workspace "${workdir}")

  if [[ "${CODEX_CRON_BYPASS_APPROVALS:-true}" == "true" ]]; then
    args+=(--force --sandbox disabled)
  else
    args+=(--sandbox "${CODEX_CRON_CURSOR_SANDBOX:-enabled}")
  fi

  if [[ -n "${CODEX_CRON_MODEL:-}" ]]; then
    args+=(--model "${CODEX_CRON_MODEL}")
  fi

  if [[ -n "${CODEX_CRON_PROFILE:-}" ]]; then
    echo "CODEX_CRON_PROFILE is only supported by the codex runner" >&2
    exit 2
  fi
fi

if [[ -n "${CODEX_CRON_EXTRA_ARGS:-}" ]]; then
  read -r -a extra_args <<< "${CODEX_CRON_EXTRA_ARGS}"
  args+=("${extra_args[@]}")
fi

{
  echo "job=${job_name}"
  echo "job_id=${job_id}"
  echo "runner=${runner}"
  echo "model=${CODEX_CRON_MODEL:-}"
  echo "run_id=${run_id}"
  echo "started_at=${started_at}"
  echo "workdir=${workdir}"
  echo "prompt_file=${prompt_file}"
  echo "stdout_log=${stdout_log}"
  echo "stderr_log=${stderr_log}"
  echo "${runner}_args=${args[*]}"
} > "${run_dir}/metadata.env"

set +e
if [[ "${runner}" == "codex" ]]; then
  codex "${args[@]}" - < "${prompt_file}" > "${stdout_log}" 2> "${stderr_log}"
else
  cursor-agent "${args[@]}" "$(< "${prompt_file}")" > "${stdout_log}" 2> "${stderr_log}"
fi
exit_code=$?
set -e

if [[ "${runner}" == "cursor" && -f "${stdout_log}" ]]; then
  cp "${stdout_log}" "${last_message}"
fi

finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
status="ok"
if [[ "${exit_code}" -ne 0 ]]; then
  status="error"
fi

cat > "${summary_file}" <<EOF
{:job "${job_id}"
 :name "${job_name}"
 :runner "${runner}"
 :model "${CODEX_CRON_MODEL:-}"
 :run-id "${run_id}"
 :status :${status}
 :exit-code ${exit_code}
 :started-at "${started_at}"
 :finished-at "${finished_at}"
 :workdir "${workdir}"
 :prompt-file "${prompt_file}"}
EOF

echo "Codex cron ${job_id}/${run_id} [${runner}]: ${status} (exit ${exit_code})"
exit "${exit_code}"
