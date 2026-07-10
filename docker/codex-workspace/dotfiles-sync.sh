#!/usr/bin/env bash
set -o pipefail

TARGET_DIR="${DOTFILES_DIR:-/home/boxp/ghq/github.com/boxp/dotfiles}"
DOTFILES_REPO="${DOTFILES_REPO:-https://github.com/boxp/dotfiles}"
SYNC_INTERVAL="${SYNC_INTERVAL:-300}"
FIRST_SYNC_DONE=false
SETUP_NEEDED=false

log() { echo "[dotfiles-sync] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

run_setup() {
  log "Running setup.sh ..."
  if runuser -u boxp -- env HOME=/home/boxp sh "${TARGET_DIR}/setup.sh"; then
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
    log "Target not found, cloning ${DOTFILES_REPO} ..."
    mkdir -p "$(dirname "${TARGET_DIR}")"
    if git clone --branch master "${DOTFILES_REPO}" "${TARGET_DIR}"; then
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
  case "${remote_url}" in
    *boxp/dotfiles*) ;;
    *)
      log "ERROR: ${TARGET_DIR} origin is '${remote_url}', expected boxp/dotfiles, skipping"
      return
      ;;
  esac

  if ! git -C "${TARGET_DIR}" fetch origin master 2>&1 | while IFS= read -r line; do log "fetch: $line"; done; then
    log "fetch failed, will retry next cycle"
    return
  fi

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
    local old_head remote_head
    old_head=$(git -C "${TARGET_DIR}" rev-parse HEAD)
    remote_head=$(git -C "${TARGET_DIR}" rev-parse origin/master)
    if [ "${old_head}" != "${remote_head}" ]; then
      if ! git -C "${TARGET_DIR}" merge --ff-only origin/master 2>&1 | while IFS= read -r line; do log "merge: $line"; done; then
        log "fast-forward failed at ${TARGET_DIR}, will retry next cycle"
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
  local old_head remote_head new_head
  old_head=$(git -C "${TARGET_DIR}" rev-parse HEAD)
  remote_head=$(git -C "${TARGET_DIR}" rev-parse origin/master)
  if [ "${old_head}" = "${remote_head}" ]; then
    log "Already up to date (${old_head:0:8})"
    return
  fi
  if ! git -C "${TARGET_DIR}" merge --ff-only origin/master 2>&1 | while IFS= read -r line; do log "merge: $line"; done; then
    log "fast-forward failed at ${TARGET_DIR}, will retry next cycle"
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
