#!/usr/bin/env bash
set -euo pipefail

install -d -o boxp -g boxp -m 0755 /home/boxp
install -d -o boxp -g boxp -m 0700 "${CODEX_NOVEL_BOARD_ROOT:-/home/boxp/.novel-board}"

if [[ "${CODEX_WORKSPACE_ROLE:-workspace}" == "novel-board-runner" ]]; then
  exec /usr/sbin/runuser -u boxp -- env HOME=/home/boxp \
    "${CODEX_NOVEL_BOARD_RUNNER:-/opt/codex-workspace/novel-board/novel_board_runner.bb}" loop
fi

install -d -m 0755 /run/sshd
/usr/sbin/runuser -u boxp -- install -d -m 0700 /home/boxp/.ssh
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex/skills
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex-cron
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.codex-task-board
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.pi/agent/extensions
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/.local/bin
default_task_board_vault=/home/boxp/Documents/obsidian-headless/BOXP
task_board_vault="${CODEX_TASK_BOARD_VAULT:-${default_task_board_vault}}"
if [[ -n "${CODEX_CRON_ROOT:-}" ]]; then
  codex_cron_root="${CODEX_CRON_ROOT}"
else
  codex_cron_root="${task_board_vault}/Infrastructure/Codex Cron"
fi

/usr/sbin/runuser -u boxp -- install -d -m 0755 "${codex_cron_root}"
/usr/sbin/runuser -u boxp -- install -d -m 0755 /home/boxp/ghq

export EDITOR="${EDITOR:-vim}"
export VISUAL="${VISUAL:-vim}"

configure_codex() {
  local config=/home/boxp/.codex/config.toml
  local tmp="${config}.tmp"

  /usr/sbin/runuser -u boxp -- touch "${config}"
  {
    printf 'check_for_update_on_startup = false\n'
    sed -E '/^[[:space:]]*check_for_update_on_startup[[:space:]]*=/d' "${config}"
  } >"${tmp}"
  mv "${tmp}" "${config}"
  chown boxp:boxp "${config}"
  chmod 0600 "${config}"
}

move_pi_extension_entry() {
  local entry="$1"
  local name dest i

  name="$(basename "${entry}")"
  dest="/home/boxp/.pi/agent/extensions/${name}"
  i=1
  while [[ -e "${dest}" ]]; do
    dest="/home/boxp/.pi/agent/extensions/${name}.legacy-${i}"
    i=$((i + 1))
  done
  mv "${entry}" "${dest}"
}

configure_pi_agent() {
  local entry name lower

  if [[ -d /home/boxp/.pi/agent/hooks ]]; then
    while IFS= read -r -d '' entry; do
      move_pi_extension_entry "${entry}"
    done < <(find /home/boxp/.pi/agent/hooks -mindepth 1 -maxdepth 1 -print0)
    rmdir /home/boxp/.pi/agent/hooks 2>/dev/null || true
  fi

  if [[ -d /home/boxp/.pi/agent/tools ]]; then
    while IFS= read -r -d '' entry; do
      name="$(basename "${entry}")"
      lower="${name,,}"
      case "${lower}" in
        fd|rg|fd.exe|rg.exe|.*)
          continue
          ;;
      esac
      move_pi_extension_entry "${entry}"
    done < <(find /home/boxp/.pi/agent/tools -mindepth 1 -maxdepth 1 -print0)
    rmdir /home/boxp/.pi/agent/tools 2>/dev/null || true
  fi

  chown -R boxp:boxp /home/boxp/.pi/agent
}

if [[ -d /opt/codex-workspace/skills ]]; then
  /usr/sbin/runuser -u boxp -- cp -R --no-preserve=mode,ownership \
    /opt/codex-workspace/skills/. /home/boxp/.codex/skills/
fi

install_vault_seed() {
  local seed="${CODEX_WORKSPACE_RECURRING_EVENTS_SEED:-/opt/codex-workspace/recurring-events/vault-seed}"
  local vault="${task_board_vault}"
  local src rel dest existing_task_board_vault

  if [[ ! -d "${seed}" ]]; then
    return
  fi

  existing_task_board_vault=false
  if [[ -f "${vault}/Boards/Task Board.md" || -d "${vault}/Tickets" ]]; then
    existing_task_board_vault=true
  fi

  while IFS= read -r -d '' src; do
    rel="${src#"${seed}/"}"
    if [[ "${existing_task_board_vault}" == true && "${rel}" == Infrastructure/Recurring\ Events/Events/* ]]; then
      continue
    fi
    dest="${vault}/${rel}"
    if [[ ! -e "${dest}" ]]; then
      install -d -o boxp -g boxp -m 0755 "$(dirname "${dest}")"
      install -o boxp -g boxp -m 0644 "${src}" "${dest}"
    fi
  done < <(find "${seed}" -type f -print0)
}

install_novel_board_seed() {
  local seed="${CODEX_NOVEL_BOARD_SEED:-/opt/codex-workspace/novel-board/vault-seed}"
  local vault="${CODEX_NOVEL_BOARD_VAULT:-${task_board_vault}}"
  local src rel dest

  if [[ ! -d "${seed}" ]]; then
    return
  fi

  while IFS= read -r -d '' src; do
    rel="${src#"${seed}/"}"
    dest="${vault}/${rel}"
    if [[ ! -e "${dest}" ]]; then
      install -d -o boxp -g boxp -m 0755 "$(dirname "${dest}")"
      install -o boxp -g boxp -m 0644 "${src}" "${dest}"
    fi
  done < <(find "${seed}" -type f -print0)
}

install_codex_cron_seed_files() {
  local seed="${CODEX_WORKSPACE_RECURRING_EVENTS_SEED:-/opt/codex-workspace/recurring-events/vault-seed}/Infrastructure/Codex Cron"
  local src rel dest

  if [[ ! -d "${seed}" ]]; then
    return
  fi

  while IFS= read -r -d '' src; do
    rel="${src#"${seed}/"}"
    if [[ "${rel}" == "jobs.edn" ]]; then
      continue
    fi
    dest="${codex_cron_root}/${rel}"
    if [[ ! -e "${dest}" ]]; then
      install -d -o boxp -g boxp -m 0755 "$(dirname "${dest}")"
      install -o boxp -g boxp -m 0644 "${src}" "${dest}"
    fi
  done < <(find "${seed}" -type f -print0)
}

ensure_recurring_events_cron_job() {
  local seed="${CODEX_WORKSPACE_RECURRING_EVENTS_SEED:-/opt/codex-workspace/recurring-events/vault-seed}/Infrastructure/Codex Cron/jobs.edn"
  local jobs="${codex_cron_root}/jobs.edn"

  if [[ ! -f "${seed}" ]]; then
    return
  fi

  install -d -o boxp -g boxp -m 0755 "$(dirname "${jobs}")"
  bb -e '
    (require (quote [clojure.edn :as edn]))
    (defn read-edn [path fallback]
      (if (.exists (java.io.File. path))
        (edn/read-string (slurp path))
        fallback))
    (defn registry [value]
      (cond
        (vector? value) {:version 1 :jobs value}
        (map? value) (update value :jobs #(vec (or % [])))
        :else {:version 1 :jobs []}))
    (def stale-output-root "/home/boxp/Documents/obsidian-headless/BOXP/Infrastructure/Codex Cron/runs")
    (defn migrate-job [seed-job job]
      (if (and seed-job
               (= (:id job) (:id seed-job))
               (= stale-output-root (:output-root job)))
        (dissoc job :output-root)
        job))
    (let [[target seed] *command-line-args*
          seed-job (first (:jobs (registry (read-edn seed {:version 1 :jobs []}))))
          current (registry (read-edn target {:version 1 :jobs []}))
          jobs (mapv #(migrate-job seed-job %) (:jobs current))
          next-jobs (if (and seed-job (not-any? #(= (:id %) (:id seed-job)) jobs))
                      (conj jobs seed-job)
                      jobs)]
      (when (not= next-jobs (:jobs current))
        (spit target (str (pr-str (assoc current :jobs next-jobs)) "\n"))))
  ' "${jobs}" "${seed}"
  chown boxp:boxp "${jobs}"
}

install_vault_seed
install_novel_board_seed
install_codex_cron_seed_files
ensure_recurring_events_cron_job
if [[ "${CODEX_WORKSPACE_ENTRYPOINT_SEED_ONLY:-}" == "1" ]]; then
  exit 0
fi
configure_codex
configure_pi_agent

if [[ -f /tmp/authorized_keys/authorized_keys ]]; then
  /usr/sbin/runuser -u boxp -- install -m 0600 \
    /tmp/authorized_keys/authorized_keys /home/boxp/.ssh/authorized_keys
fi

write_session_env() {
  local env_dir=/run/codex-workspace
  local env_file="${env_dir}/session-env"
  local env_tmp="${env_file}.tmp"
  local profile_file=/etc/profile.d/codex-workspace-env.sh
  local name

  install -d -o boxp -g boxp -m 0700 "${env_dir}"
  : >"${env_tmp}"
  chmod 0600 "${env_tmp}"

  for name in \
    DOCKER_HOST \
    DOCKER_BUILDKIT \
    EDITOR \
    VISUAL \
    ANTHROPIC_API_KEY \
    ANTHROPIC_AUTH_TOKEN \
    ANTHROPIC_BASE_URL \
    CLAUDE_CODE_OAUTH_TOKEN \
    CLAUDE_CODE_USE_BEDROCK \
    CLAUDE_CODE_USE_VERTEX \
    CLAUDE_CODE_USE_FOUNDRY \
    GRAFANA_URL \
    GRAFANA_SERVICE_ACCOUNT_TOKEN \
    GEMINI_API_KEY \
    CODEX_TASK_BOARD_VAULT \
    CODEX_CRON_ROOT \
    KUBECONFIG; do
    if [[ -n "${!name:-}" ]]; then
      printf 'export %s=%q\n' "${name}" "${!name}" >>"${env_tmp}"
    fi
  done

  chown boxp:boxp "${env_tmp}"
  mv "${env_tmp}" "${env_file}"

  cat >"${profile_file}" <<'EOF'
if [ -r /run/codex-workspace/session-env ]; then
  . /run/codex-workspace/session-env
fi
EOF
  chmod 0644 "${profile_file}"
}

write_session_env

ssh-keygen -A
/usr/sbin/sshd -D -e -p "${SSHD_PORT:-2222}" &

/usr/sbin/runuser -u boxp -- env HOME=/home/boxp /opt/codex-workspace/dotfiles-sync.sh &

cd /home/boxp

token_args=()
if [[ -n "${EVEN_TERMINAL_TOKEN:-}" ]]; then
  token_args=(--token "${EVEN_TERMINAL_TOKEN}")
fi

exec /usr/sbin/runuser -u boxp \
  --whitelist-environment=DOCKER_HOST,DOCKER_BUILDKIT,EDITOR,VISUAL,ANTHROPIC_API_KEY,ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL,CLAUDE_CODE_OAUTH_TOKEN,CLAUDE_CODE_USE_BEDROCK,CLAUDE_CODE_USE_VERTEX,CLAUDE_CODE_USE_FOUNDRY,GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN,GEMINI_API_KEY,CODEX_TASK_BOARD_VAULT,CODEX_CRON_ROOT,KUBECONFIG \
  -- env HOME=/home/boxp even-terminal \
  --port "${EVEN_TERMINAL_PORT:-3456}" \
  --cwd "${EVEN_TERMINAL_CWD:-/home/boxp}" \
  --provider "${EVEN_TERMINAL_PROVIDER:-codex}" \
  --name "${EVEN_TERMINAL_NAME:-lolice-codex-workspace}" \
  "${token_args[@]}"
