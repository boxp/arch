# shellcheck shell=bash
require_tmp() {
  local base=/home/boxp/.codex-task-board/workspaces/BOXP-561/ resolved
  [[ ${BOXP561_TMP:-} = /* && -d ${BOXP561_TMP:-} ]] || {
    echo 'BOXP561_TMP must be an existing absolute workspace directory' >&2
    return 1
  }
  resolved=$(realpath -e -- "$BOXP561_TMP")
  [[ $resolved = "$base"* ]] || {
    echo 'BOXP561_TMP outside BOXP-561 workspace' >&2
    return 1
  }
  BOXP561_TMP=$resolved
}
under_tmp() { [[ $(realpath -m -- "$1") = "$BOXP561_TMP/"* ]]; }
