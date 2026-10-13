#!/usr/bin/env bash
set -euo pipefail

# Git's SSH transport calls this wrapper. Only GitHub receives noninteractive,
# strict host-key options; every other SSH destination keeps the user's normal
# ssh configuration and arguments.
if [[ "${1:-}" == "--ssh-mode" ]]; then
  shift
  [[ $# -ge 1 ]] || { echo "missing ssh destination" >&2; exit 2; }
  ssh_args=("$@")
  destination=""
  index=0
  probe_args=()
  while (( index < ${#ssh_args[@]} )); do
    arg="${ssh_args[index]}"
    case "${arg}" in
      --) (( index += 1 )); destination="${ssh_args[index]:-}"; probe_args+=(-- "${destination}"); break ;;
      -p|-l|-o|-i|-F|-J|-W|-b|-c|-D|-L|-R|-S|-w)
        probe_args+=("${arg}" "${ssh_args[index+1]:-}"); (( index += 2 )) ;;
      -*) probe_args+=("${arg}"); (( index += 1 )) ;;
      *) destination="${arg}"; probe_args+=("${destination}"); break ;;
    esac
  done
  literal_host="${destination##*@}"
  if [[ "${literal_host,,}" == github.com || "${literal_host,,}" == ssh.github.com ]]; then
    is_github=true
  else
    resolved_host="$(ssh -G "${probe_args[@]}" 2>/dev/null | awk 'tolower($1) == "hostname" { print tolower($2); exit }' || true)"
    [[ "${resolved_host}" == github.com || "${resolved_host}" == ssh.github.com ]] && is_github=true || is_github=false
  fi
  if [[ "${is_github}" == true ]]; then
    exec ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$@"
  fi
  exec ssh "$@"
fi

if [[ "${1:-}" != "--install" || $# -ne 1 ]]; then
  echo "usage: $0 --install | --ssh-mode <ssh arguments...>" >&2
  exit 2
fi

home="${HOME:-}"
if [[ -n "${GIT_CONFIG_GLOBAL:-}" ]]; then
  echo "refusing to install while GIT_CONFIG_GLOBAL overrides normal configuration" >&2
  exit 1
fi
if [[ "${home}" != /* || ! -d "${home}" || "$(stat -c %u "${home}")" != "$(id -u)" ]]; then
  echo "refusing to configure Git outside the current user's existing HOME" >&2
  exit 1
fi

xdg_home="${XDG_CONFIG_HOME:-${home}/.config}"
if [[ "${xdg_home}" != /* || "$(realpath -m "${xdg_home}")" != "$(realpath "${home}")/"* ]]; then
  echo "XDG_CONFIG_HOME must be an absolute path within HOME" >&2
  exit 1
fi
git_config="${xdg_home}/git/config"
include_file="${home}/.local/share/codex-workspace/github-git.inc"
if [[ "$(realpath -m "$(dirname "${include_file}")")" != "$(realpath "${home}")/"* ]]; then
  echo "managed Git include directory must remain within HOME" >&2
  exit 1
fi
ssh_wrapper="$(realpath "${BASH_SOURCE[0]}")"
include_line=$(printf '[url "ssh://git@github.com/"]\n\tinsteadOf = https://github.com/\n[core]\n\tsshCommand = %s --ssh-mode\n' \
  "${ssh_wrapper}")
mkdir -p "$(dirname "${git_config}")" "$(dirname "${include_file}")"
chmod 0700 "$(dirname "${include_file}")"

if [[ -e "${include_file}" || -L "${include_file}" ]]; then
  [[ -f "${include_file}" && ! -L "${include_file}" && "$(cat "${include_file}")" == "${include_line%$'\n'}" ]] || {
    echo "managed Git include conflicts with existing file: ${include_file}" >&2; exit 1;
  }
else
  tmp="${include_file}.tmp.$$"
  printf '%s' "${include_line}" >"${tmp}"
  chmod 0600 "${tmp}"
  mv "${tmp}" "${include_file}"
fi

if [[ -e "${git_config}" || -L "${git_config}" ]]; then
  [[ -f "${git_config}" && ! -L "${git_config}" ]] || { echo "Git XDG config is not a regular file: ${git_config}" >&2; exit 1; }
else
  install -m 0600 /dev/null "${git_config}"
fi

if git config --file "${git_config}" --get-all include.path 2>/dev/null | grep -Fxq "${include_file}"; then
  already_installed=true
else
  already_installed=false
fi

# Recheck on every startup, including after dotfiles/user changes. Only the
# exact managed settings are accepted; do not log potentially secret values.
for file in "${home}/.gitconfig" "${git_config}"; do
  [[ -f "${file}" ]] || continue
  if ! git config --includes --file "${file}" --list >/dev/null 2>&1; then
    echo "cannot parse Git configuration: ${file}" >&2
    exit 1
  fi
  while IFS= read -r command; do
    if [[ "${command}" != "${ssh_wrapper} --ssh-mode" ]]; then
      echo "existing core.sshCommand in ${file} conflicts with managed GitHub SSH transport" >&2
      exit 1
    fi
  done < <(git config --includes --file "${file}" --get-all core.sshCommand 2>/dev/null || true)
  while IFS= read -r key; do
    [[ "${key,,}" == url.*.insteadof || "${key,,}" == url.*.pushinsteadof ]] || continue
    while IFS= read -r value; do
      if [[ "${key,,}" == 'url.ssh://git@github.com/.insteadof' && "${value}" == 'https://github.com/' ]]; then
        continue
      fi
      if [[ "${value,,}" == *github.com* || ( "${key,,}" == *.pushinsteadof && 'https://github.com/' == "${value}"* ) ]]; then
        echo "existing GitHub URL rewrite in ${file} conflicts with managed GitHub SSH transport" >&2
        exit 1
      fi
    done < <(git config --includes --file "${file}" --get-all "${key}" 2>/dev/null)
  done < <(git config --includes --file "${file}" --name-only --list 2>/dev/null | sed '/^$/d')
done
if [[ "${already_installed}" == false ]]; then
  git config --file "${git_config}" --add include.path "${include_file}"
fi

echo "GitHub Git SSH transport configured for ${home}"
