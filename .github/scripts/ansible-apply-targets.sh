#!/usr/bin/env bash
# Resolve which apply-ansible nodes are affected by a set of changed files.
#
# Usage:
#   ansible-apply-targets.sh [-C <repo-root>] [--explain] <changed-file>...
#   ... | ansible-apply-targets.sh [-C <repo-root>] [--explain] -
#   ansible-apply-targets.sh --nodes <node>[,<node>...]   (explicit list, validated and ordered)
#
# Prints a JSON array of node names (in canonical order) to stdout.
# With --explain, prints one "<file> -> <nodes>" line per changed file to stderr.
#
# Mapping (see docs/project_docs/BOXP-267/plan-apply-ansible-targets.md):
#   ansible/playbooks/control-plane.yml       -> every shanghai-* node
#   ansible/playbooks/worker-image.yml        -> every golyat-* node
#   ansible/playbooks/node-<node>.yml         -> <node> (if it is an apply target)
#   other ansible/playbooks/*.yml             -> nodes of playbooks that reference it
#                                                (none when standalone, e.g. upgrade-k8s.yml)
#   ansible/roles/<role>/**                   -> nodes of playbooks that use <role>
#   ansible/files/**, ansible/templates/**    -> nodes of playbooks/roles that reference the file
#   ansible/vars/*.yml                        -> nodes of playbooks that load the file
#                                                (nodes.yml -> every node, worker_nodes.yml -> golyat-*)
#   ansible/group_vars/control_plane.yml      -> every shanghai-* node
#   ansible/tests/**, *.md, molecule/**, lint -> no node
#   **/__pycache__/**, *.pyc                  -> no node (Python bytecode is never Ansible content)
#   anything else under ansible/              -> every node (shared: inventories, vars, uv.lock, ...)
#   anything outside ansible/                 -> no node (workflow/doc edits do not change Ansible content)
# Unresolvable references (role/file used nowhere we can see) fall back to every node,
# which is the pre-existing behaviour of the workflow.
set -euo pipefail

repo_root="."
explain=0
requested=""
nodes_mode=0
files=()
while [ $# -gt 0 ]; do
  case "$1" in
    -C)
      repo_root="$2"
      shift 2
      ;;
    --nodes)
      requested="$2"
      nodes_mode=1
      shift 2
      ;;
    --explain)
      explain=1
      shift
      ;;
    -)
      while IFS= read -r line; do
        for token in $line; do
          files+=("$token")
        done
      done
      shift
      ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      files+=("$1")
      shift
      ;;
  esac
done

cd "$repo_root"

read -r -a ALL_NODES <<<"${ANSIBLE_APPLY_NODES:-shanghai-1 shanghai-2 shanghai-3 golyat-4}"
PLAYBOOK_DIR="ansible/playbooks"
ROLE_DIR="ansible/roles"

declare -A selected=()

is_apply_node() {
  local node="$1" n
  for n in "${ALL_NODES[@]}"; do
    [ "$n" = "$node" ] && return 0
  done
  return 1
}

# Echo the nodes (space separated) that the apply workflow runs <playbook> against.
nodes_for_playbook() {
  local playbook="$1" n
  case "$(basename "$playbook")" in
    control-plane.yml)
      for n in "${ALL_NODES[@]}"; do [[ "$n" == shanghai-* ]] && echo "$n"; done
      ;;
    worker-image.yml)
      for n in "${ALL_NODES[@]}"; do [[ "$n" == golyat-* ]] && echo "$n"; done
      ;;
    node-*.yml)
      n="$(basename "$playbook" .yml)"
      n="${n#node-}"
      is_apply_node "$n" && echo "$n"
      ;;
    *)
      # Standalone / manual playbook: only matters if a primary playbook references it.
      local ref
      while IFS= read -r ref; do
        [ -n "$ref" ] && [ "$ref" != "$playbook" ] && nodes_for_playbook "$ref"
      done < <(playbooks_referencing "$(basename "$playbook")")
      ;;
  esac
  return 0
}

# Playbooks under ansible/playbooks whose text contains <needle> as a whole word.
playbooks_referencing() {
  local needle="$1"
  [ -d "$PLAYBOOK_DIR" ] || return 0
  grep -rlF --include='*.yml' --include='*.yaml' -w -- "$needle" "$PLAYBOOK_DIR" 2>/dev/null || true
}

# Roles under ansible/roles whose files (excluding molecule tests) contain <needle>.
roles_referencing() {
  local needle="$1"
  [ -d "$ROLE_DIR" ] || return 0
  grep -rlF --exclude-dir=molecule -w -- "$needle" "$ROLE_DIR" 2>/dev/null \
    | awk -F/ '{print $3}' | sort -u || true
}

nodes_for_role() {
  local role="$1" ref found=0
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    found=1
    nodes_for_playbook "$ref"
  done < <(playbooks_referencing "$role")
  [ "$found" -eq 1 ] || printf '%s\n' "${ALL_NODES[@]}"
  return 0
}

nodes_for_asset() {
  local path="$1" base ref role found=0
  base="$(basename "$path")"
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    found=1
    nodes_for_playbook "$ref"
  done < <(playbooks_referencing "$base")
  while IFS= read -r role; do
    [ -n "$role" ] || continue
    found=1
    nodes_for_role "$role"
  done < <(roles_referencing "$base")
  [ "$found" -eq 1 ] || printf '%s\n' "${ALL_NODES[@]}"
  return 0
}

nodes_for_file() {
  local f="$1"
  case "$f" in
    ansible/*) ;;
    *) return 0 ;;
  esac
  case "$f" in
    *.md|ansible/tests/*|ansible/.ansible-lint|ansible/roles/*/molecule/*|*/__pycache__/*|*.pyc)
      return 0
      ;;
    ansible/playbooks/*.yml|ansible/playbooks/*.yaml)
      nodes_for_playbook "$f"
      ;;
    ansible/roles/*/*)
      nodes_for_role "$(echo "$f" | cut -d/ -f3)"
      ;;
    ansible/files/*|ansible/templates/*|ansible/vars/*.yml|ansible/vars/*.yaml)
      nodes_for_asset "$f"
      ;;
    ansible/group_vars/control_plane.yml)
      nodes_for_playbook control-plane.yml
      ;;
    *)
      printf '%s\n' "${ALL_NODES[@]}"
      ;;
  esac
}

if [ "$nodes_mode" -eq 1 ]; then
  # Explicit node list (workflow_dispatch): validate every entry, emit canonical order.
  if [ "${#files[@]}" -gt 0 ]; then
    echo "::error::--nodes cannot be combined with changed files" >&2
    exit 2
  fi
  for n in $(echo "$requested" | tr ',' ' '); do
    if ! is_apply_node "$n"; then
      echo "::error::'$n' is not an apply node (allowed: ${ALL_NODES[*]})" >&2
      exit 2
    fi
    selected["$n"]=1
  done
  if [ "${#selected[@]}" -eq 0 ]; then
    echo "::error::--nodes needs at least one node" >&2
    exit 2
  fi
fi

for f in "${files[@]+"${files[@]}"}"; do
  [ -n "$f" ] || continue
  mapped=()
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    if ! is_apply_node "$n"; then
      echo "::error::internal: '$n' is not an apply node" >&2
      exit 2
    fi
    selected["$n"]=1
    mapped+=("$n")
  done < <(nodes_for_file "$f" | sort -u)
  if [ "$explain" -eq 1 ]; then
    if [ "${#mapped[@]}" -eq 0 ]; then
      echo "$f -> (no node)" >&2
    else
      echo "$f -> ${mapped[*]}" >&2
    fi
  fi
done

out=()
for n in "${ALL_NODES[@]}"; do
  [ -n "${selected[$n]+x}" ] && out+=("$n")
done
if [ "${#out[@]}" -eq 0 ]; then
  echo '[]'
else
  printf '%s\n' "${out[@]}" | sed 's/.*/"&"/' | paste -sd, | sed 's/.*/[&]/'
fi
