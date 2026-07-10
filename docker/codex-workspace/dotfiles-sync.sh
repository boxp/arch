#!/usr/bin/env bash
set -o pipefail

TARGET_DIR="${DOTFILES_DIR:-/home/boxp/ghq/github.com/boxp/dotfiles}"
SYNC_INTERVAL="${SYNC_INTERVAL:-300}"
FIRST_SYNC_DONE=false
SETUP_NEEDED=false

# Hardcoded allowed URL — not overridable via environment variable to prevent
# arbitrary repo execution via DOTFILES_REPO override
readonly EXPECTED_DOTFILES_REPO="https://github.com/boxp/dotfiles"

log() { echo "[dotfiles-sync] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

is_valid_dotfiles_url() {
  local url="$1"
  [[ "$url" == "https://github.com/boxp/dotfiles" ]] || \
  [[ "$url" == "https://github.com/boxp/dotfiles.git" ]] || \
  [[ "$url" == "git@github.com:boxp/dotfiles.git" ]]
}

run_setup() {
  log "Running setup.sh ..."
  if env HOME=/home/boxp sh "${TARGET_DIR}/setup.sh"; then
    log "setup.sh succeeded"
    SETUP_NEEDED=false
  else
    local rc=$?
    log "setup.sh failed (exit $rc) for ${TARGET_DIR}, will retry next cycle"
    SETUP_NEEDED=true
  fi
}

sync_once() {
  if [ ! -e "${TARGET_DIR}" ]; then
    log "Target not found, cloning ${EXPECTED_DOTFILES_REPO} ..."
    mkdir -p "$(dirname "${TARGET_DIR}")"
    if git clone --branch master "${EXPECTED_DOTFILES_REPO}" "${TARGET_DIR}"; then
      local cloned_remote
      cloned_remote=$(git -C "${TARGET_DIR}" remote get-url origin 2>/dev/null || echo "")
      if ! is_valid_dotfiles_url "${cloned_remote}"; then
        log "ERROR: Cloned remote '${cloned_remote}' is not the expected dotfiles repo. Removing clone."
        rm -rf "${TARGET_DIR}"
        return
      fi
      log "Clone succeeded"
      FIRST_SYNC_DONE=true
      SETUP_NEEDED=true
    else
      log "Clone failed, will retry next cycle"
    fi
    return
  fi

  if ! git -C "${TARGET_DIR}" rev-parse --git-dir > /dev/null 2>&1; then
    log "ERROR: ${TARGET_DIR} is not a git repository, skipping"
    return
  fi

  local remote_url
  remote_url=$(git -C "${TARGET_DIR}" remote get-url origin 2>/dev/null || echo "")
  if ! is_valid_dotfiles_url "${remote_url}"; then
    log "ERROR: ${TARGET_DIR} origin is '${remote_url}', expected exact boxp/dotfiles URL, skipping"
    return
  fi

  local fetch_output
  if ! fetch_output=$(git -C "${TARGET_DIR}" fetch origin master 2>&1); then
    log "fetch failed: ${fetch_output}, will retry next cycle"
    return
  fi
  log "fetch: ${fetch_output}"

  if [ "${FIRST_SYNC_DONE}" = "false" ]; then
    if ! git -C "${TARGET_DIR}" diff --quiet HEAD 2>/dev/null || \
       ! git -C "${TARGET_DIR}" diff --quiet --cached 2>/dev/null; then
      log "WARNING: tracked file changes detected at ${TARGET_DIR}, skipping sync and setup.sh"
      return
    fi
    if ! git -C "${TARGET_DIR}" merge-base --is-ancestor HEAD origin/master 2>/dev/null; then
      log "WARNING: local HEAD is not an ancestor of origin/master (diverged) at ${TARGET_DIR}, skipping sync and setup.sh"
      return
    fi
    local old_head remote_head merge_output
    old_head=$(git -C "${TARGET_DIR}" rev-parse HEAD)
    remote_head=$(git -C "${TARGET_DIR}" rev-parse origin/master)
    if [ "${old_head}" != "${remote_head}" ]; then
      if ! merge_output=$(git -C "${TARGET_DIR}" merge --ff-only origin/master 2>&1); then
        log "fast-forward failed at ${TARGET_DIR}: ${merge_output}, will retry next cycle"
        return
      fi
      log "fast-forward succeeded: ${old_head:0:8} -> ${remote_head:0:8}"
    else
      log "Already up to date (${old_head:0:8})"
    fi
    FIRST_SYNC_DONE=true
    SETUP_NEEDED=true
    return
  fi

  if ! git -C "${TARGET_DIR}" diff --quiet HEAD 2>/dev/null || \
     ! git -C "${TARGET_DIR}" diff --quiet --cached 2>/dev/null; then
    log "WARNING: tracked file changes detected at ${TARGET_DIR}, skipping sync and setup.sh"
    SETUP_NEEDED=false
    return
  fi
  if ! git -C "${TARGET_DIR}" merge-base --is-ancestor HEAD origin/master 2>/dev/null; then
    log "WARNING: local HEAD is not an ancestor of origin/master (diverged) at ${TARGET_DIR}, skipping sync and setup.sh"
    SETUP_NEEDED=false
    return
  fi
  local old_head remote_head new_head merge_output
  old_head=$(git -C "${TARGET_DIR}" rev-parse HEAD)
  remote_head=$(git -C "${TARGET_DIR}" rev-parse origin/master)
  if [ "${old_head}" = "${remote_head}" ]; then
    log "Already up to date (${old_head:0:8})"
    return
  fi
  if ! merge_output=$(git -C "${TARGET_DIR}" merge --ff-only origin/master 2>&1); then
    log "fast-forward failed at ${TARGET_DIR}: ${merge_output}, will retry next cycle"
    return
  fi
  new_head=$(git -C "${TARGET_DIR}" rev-parse HEAD)
  log "fast-forward succeeded: ${old_head:0:8} -> ${new_head:0:8}"
  SETUP_NEEDED=true
}

while true; do
  sync_once || true
  if [ "${SETUP_NEEDED}" = "true" ]; then
    run_setup || true
  fi
  log "Sleeping ${SYNC_INTERVAL}s ..."
  sleep "${SYNC_INTERVAL}"
done
