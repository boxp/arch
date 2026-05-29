#!/usr/bin/env bash
set -Eeuo pipefail

job_id="${1:-${CODEX_CRON_JOB_ID:-}}"
if [[ -z "${job_id}" ]]; then
  echo "usage: run-codex-cron.sh <job-id>" >&2
  exit 2
fi

cron_root="${CODEX_CRON_ROOT:-/home/boxp/.codex-cron}"

eval "$(
  bb /opt/codex-workspace/cron/select-codex-cron-job.bb "${job_id}"
)"

job_name="${CODEX_CRON_NAME:-${job_id}}"
prompt_file="${CODEX_CRON_PROMPT_FILE:?CODEX_CRON_PROMPT_FILE is required}"
workdir="${CODEX_CRON_WORKDIR:-/home/boxp}"
output_root="${CODEX_CRON_OUTPUT_ROOT:-${cron_root}/runs}"
lock_root="${CODEX_CRON_LOCK_ROOT:-${cron_root}/locks}"
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

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stdout_log="${run_dir}/events.jsonl"
stderr_log="${run_dir}/stderr.log"
last_message="${run_dir}/last-message.md"
summary_file="${run_dir}/summary.edn"

codex_args=(exec --json --cd "${workdir}" --output-last-message "${last_message}")

if [[ "${CODEX_CRON_BYPASS_APPROVALS:-true}" == "true" ]]; then
  codex_args+=(--dangerously-bypass-approvals-and-sandbox)
else
  codex_args+=(--sandbox "${CODEX_CRON_SANDBOX:-workspace-write}")
fi

if [[ -n "${CODEX_CRON_MODEL:-}" ]]; then
  codex_args+=(--model "${CODEX_CRON_MODEL}")
fi

if [[ -n "${CODEX_CRON_PROFILE:-}" ]]; then
  codex_args+=(--profile "${CODEX_CRON_PROFILE}")
fi

if [[ -n "${CODEX_CRON_EXTRA_ARGS:-}" ]]; then
  read -r -a extra_args <<< "${CODEX_CRON_EXTRA_ARGS}"
  codex_args+=("${extra_args[@]}")
fi

{
  echo "job=${job_name}"
  echo "job_id=${job_id}"
  echo "run_id=${run_id}"
  echo "started_at=${started_at}"
  echo "workdir=${workdir}"
  echo "prompt_file=${prompt_file}"
  echo "codex_args=${codex_args[*]}"
} > "${run_dir}/metadata.env"

set +e
codex "${codex_args[@]}" - < "${prompt_file}" > "${stdout_log}" 2> "${stderr_log}"
exit_code=$?
set -e

finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
status="ok"
if [[ "${exit_code}" -ne 0 ]]; then
  status="error"
fi

cat > "${summary_file}" <<EOF
{:job "${job_id}"
 :name "${job_name}"
 :run-id "${run_id}"
 :status :${status}
 :exit-code ${exit_code}
 :started-at "${started_at}"
 :finished-at "${finished_at}"
 :workdir "${workdir}"
 :prompt-file "${prompt_file}"}
EOF

echo "Codex cron ${job_id}/${run_id}: ${status} (exit ${exit_code})"
exit "${exit_code}"
