#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="${ROOT_DIR}/docker/codex-workspace/github-git-ssh.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

fail() { echo "error: $*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "expected $1 to contain $2"; }

# The installer accepts a disposable current-user-owned HOME and can be rerun.
unset XDG_CONFIG_HOME GIT_CONFIG_GLOBAL GIT_SSH GIT_SSH_COMMAND
export GIT_CONFIG_NOSYSTEM=1
export HOME="${tmp}/home"
mkdir -m 0700 "${HOME}"
# Git reads both normal global files for transport, even though --global
# writes/lists a single target file. Existing identity must stay intact.
printf '[user]\n\tname = fixture-existing\n\temail = fixture@example.invalid\n' >"${HOME}/.gitconfig"
"${HELPER}" --install
before="$(cat "${HOME}/.config/git/config")"
"${HELPER}" --install
[[ "$(cat "${HOME}/.config/git/config")" == "${before}" ]] || fail "install duplicated its include"
assert_contains "${HOME}/.config/git/config" "${HOME}/.local/share/codex-workspace/github-git.inc"
[[ "$(git -C "${tmp}" config user.name)" == fixture-existing ]] || fail "existing Git identity changed"

mkdir -p "${tmp}/bin"
cat >"${tmp}/bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == -G ]]; then
  host=""
  for arg in "$@"; do
    case "$arg" in
      -G|-p|-l|-o|-i|-F|-J|-W|-b|-c|-D|-L|-R|-S|-w) continue ;;
      -*|[0-9]*) continue ;;
      *) host="${arg##*@}" ;;
    esac
  done
  case "$host" in
    github-alias) printf 'hostname ssh.github.com\n' ;;
    *) printf 'hostname %s\n' "$host" ;;
  esac
  exit 0
fi
printf '%s\n' "$*" >>"${SSH_CALL_LOG}"
if [[ "${SSH_FAKE_REJECT:-false}" != true && "$*" == *git-upload-pack* ]]; then
  exec git-upload-pack "${SSH_BARE_REPO}"
fi
if [[ "${SSH_FAKE_REJECT:-false}" != true && "$*" == *git-receive-pack* ]]; then
  exec git-receive-pack "${SSH_BARE_REPO}"
fi
echo 'Host key verification failed.' >&2
exit 255
EOF
chmod +x "${tmp}/bin/ssh"
export PATH="${tmp}/bin:${PATH}"
export SSH_CALL_LOG="${tmp}/ssh.log"
export SSH_BARE_REPO="${tmp}/origin.git"

# A local bare repository is served through the mocked SSH process so these
# are successful Git protocol operations, not only command construction.
git init --bare --initial-branch=main "${tmp}/origin.git" >/dev/null
git init --initial-branch=main "${tmp}/seed" >/dev/null
git -C "${tmp}/seed" config user.name fixture
git -C "${tmp}/seed" config user.email fixture@example.invalid
printf 'fixture\n' >"${tmp}/seed/file"
git -C "${tmp}/seed" add file
git -C "${tmp}/seed" commit -m fixture >/dev/null
git -C "${tmp}/seed" push "${tmp}/origin.git" HEAD:refs/heads/main >/dev/null 2>&1

(cd "${tmp}" && git clone "https://github.com/boxp/fixture.git" "${tmp}/clone") >/dev/null 2>&1 || fail "clone via SSH fixture failed"
git -C "${tmp}/clone" config user.name fixture
git -C "${tmp}/clone" config user.email fixture@example.invalid
git -C "${tmp}/clone" fetch origin >/dev/null 2>&1 || fail "fetch via SSH fixture failed"
git -C "${tmp}/clone" pull origin main >/dev/null 2>&1 || fail "pull via SSH fixture failed"
printf 'pushed\n' >>"${tmp}/clone/file"
git -C "${tmp}/clone" add file
git -C "${tmp}/clone" commit -m pushed >/dev/null
git -C "${tmp}/clone" push origin HEAD:refs/heads/pushed >/dev/null 2>&1 || fail "push via SSH fixture failed"
git -C "${tmp}/clone" worktree add "${tmp}/clone-worktree" HEAD >/dev/null 2>&1 || fail "worktree creation failed"
git -C "${tmp}/clone-worktree" fetch origin >/dev/null 2>&1 || fail "new worktree could not use GitHub SSH config"
[[ "$(wc -l <"${SSH_CALL_LOG}")" -ge 5 ]] || fail "expected clone/fetch/pull/push to invoke SSH"
assert_contains "${SSH_CALL_LOG}" "BatchMode=yes"
assert_contains "${SSH_CALL_LOG}" "StrictHostKeyChecking=yes"

# A rejected unknown host key fails the Git command and does not retry HTTPS.
export SSH_FAKE_REJECT=true
before_lines="$(wc -l <"${SSH_CALL_LOG}")"
if GIT_TRACE="${tmp}/git-trace.log" git -C "${tmp}/clone" fetch origin >/dev/null 2>&1; then
  fail "fetch unexpectedly succeeded after host-key rejection"
fi
[[ "$(wc -l <"${SSH_CALL_LOG}")" -gt "${before_lines}" ]] || fail "rejected host-key fetch did not invoke SSH"
assert_contains "${tmp}/git-trace.log" "ssh"
if grep -q "git-remote-https" "${tmp}/git-trace.log"; then fail "rejected SSH transport retried through HTTPS"; fi
unset SSH_FAKE_REJECT

# Resolved GitHub aliases get strict options; unrelated hosts preserve arguments.
"${HELPER}" --ssh-mode -p 2200 github-alias true >/dev/null 2>&1 || true
last="$(tail -n 1 "${SSH_CALL_LOG}")"
[[ "${last}" == *"StrictHostKeyChecking=yes"* ]] || fail "GitHub alias did not get strict options"
before_lines="$(wc -l <"${SSH_CALL_LOG}")"
"${HELPER}" --ssh-mode -p 2200 git@example.invalid true >/dev/null 2>&1 || true
[[ "$(wc -l <"${SSH_CALL_LOG}")" -eq $((before_lines + 1)) ]] || fail "non-GitHub SSH call was not preserved"
last="$(tail -n 1 "${SSH_CALL_LOG}")"
[[ "${last}" == "-p 2200 git@example.invalid true" ]] || fail "non-GitHub SSH arguments changed: ${last}"

# The same bootstrap reproduces the config in a fresh HOME for a new workspace.
export HOME="${tmp}/new-home"
mkdir -m 0700 "${HOME}"
"${HELPER}" --install >/dev/null
git clone "https://github.com/boxp/fixture.git" "${tmp}/new-clone" >/dev/null 2>&1 || fail "new HOME could not use the GitHub SSH configuration"
# A .gitconfig created after bootstrap also keeps XDG transport active.
printf '[user]\n\tname = later-identity\n' >"${HOME}/.gitconfig"
"${HELPER}" --install >/dev/null
git -C "${tmp}/new-clone" fetch origin >/dev/null 2>&1 || fail "later .gitconfig disabled SSH"
[[ "$(git -C "${tmp}" config user.name)" == later-identity ]] || fail "later identity was not retained"

# Custom XDG paths must retain their transport settings across bootstrap.
export HOME="${tmp}/custom-xdg-home"
export XDG_CONFIG_HOME="${HOME}/custom-config"
mkdir -m 0700 "${HOME}"
"${HELPER}" --install >/dev/null
before="$(cat "${XDG_CONFIG_HOME}/git/config")"
"${HELPER}" --install >/dev/null
[[ "$(cat "${XDG_CONFIG_HOME}/git/config")" == "${before}" ]] || fail "custom XDG include duplicated"
git clone "https://github.com/boxp/fixture.git" "${tmp}/custom-xdg-clone" >/dev/null 2>&1 || fail "custom XDG clone failed"
git -C "${tmp}/custom-xdg-clone" fetch origin >/dev/null 2>&1 || fail "custom XDG fetch failed"
unset XDG_CONFIG_HOME
export HOME="${tmp}/new-home"

# Bad or conflicting bootstrap inputs fail without changing another config.
mkdir -m 0700 "${tmp}/conflict-home"
printf '[core]\n\tsshCommand = ssh -F user.conf\n' >"${tmp}/conflict-home/.gitconfig"
if HOME="${tmp}/conflict-home" "${HELPER}" --install >/dev/null 2>&1; then
  fail "existing core.sshCommand conflict was accepted"
fi
mkdir -m 0700 "${tmp}/bad-xdg-home"
if HOME="${tmp}/bad-xdg-home" XDG_CONFIG_HOME=relative "${HELPER}" --install >/dev/null 2>&1; then
  fail "relative XDG_CONFIG_HOME was accepted"
fi
if HOME="${tmp}/bad-xdg-home" GIT_CONFIG_GLOBAL="${tmp}/alternate-gitconfig" "${HELPER}" --install >/dev/null 2>&1; then
  fail "GIT_CONFIG_GLOBAL override was accepted"
fi

# Existing settings introduced after initial bootstrap must also fail closed.
printf '[core]\n\tsshCommand = ssh -F user.conf\n' >"${HOME}/.gitconfig"
if "${HELPER}" --install >/dev/null 2>&1; then fail "later SSH override accepted"; fi
rm "${HOME}/.gitconfig"
printf '[url "https://mirror.invalid/"]\n\tpushInsteadOf = https://\n' >"${HOME}/.gitconfig"
if "${HELPER}" --install >/dev/null 2>&1; then fail "generic push rewrite accepted"; fi
rm "${HOME}/.gitconfig"
# Nested includes and malformed configuration are checked without value logs.
printf '[include]\n\tpath = %s\n' "${tmp}/nested.inc" >"${HOME}/.gitconfig"
printf '[core]\n\tsshCommand = ssh\n' >"${tmp}/nested.inc"
if "${HELPER}" --install >/dev/null 2>&1; then fail "nested override accepted"; fi
rm "${HOME}/.gitconfig"
if XDG_CONFIG_HOME="${tmp}/outside-home" "${HELPER}" --install >/dev/null 2>&1; then fail "external XDG path accepted"; fi
if HOME=relative "${HELPER}" --install >/dev/null 2>&1; then fail "invalid HOME accepted"; fi
printf '[broken\n' >"${HOME}/.gitconfig"
if "${HELPER}" --install >/dev/null 2>&1; then fail "malformed config accepted"; fi
rm "${HOME}/.gitconfig"
"${HELPER}" --install >/dev/null
# Non-GitHub HTTPS URLs keep their transport and raw HTTPS origins stay intact.
git -C "${tmp}/clone" remote add other https://example.invalid/fixture.git
[[ "$(git -C "${tmp}/clone" remote get-url other)" == https://example.invalid/fixture.git ]] || fail "other HTTPS host changed"
[[ "$(git -C "${tmp}/clone" config remote.origin.url)" == https://github.com/boxp/fixture.git ]] || fail "raw origin changed"
[[ "$(git -C "${tmp}/clone" remote get-url --push origin)" == ssh://git@github.com/boxp/fixture.git ]] || fail "HTTPS push transport not rewritten"
echo "github Git SSH tests passed"
