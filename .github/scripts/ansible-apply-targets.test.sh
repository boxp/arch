#!/usr/bin/env bash
# Regression tests for ansible-apply-targets.sh.
# Runs against a synthetic fixture tree (so results do not drift with the real
# repository) plus a few assertions against the real checkout.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
script="$here/ansible-apply-targets.sh"

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture"/ansible/{playbooks,files,templates,tests,vars,inventories/production,group_vars} \
  "$fixture"/ansible/roles/{shared_role,cp_role,worker_role,upgrade_role,orphan_role}/tasks \
  "$fixture"/ansible/roles/worker_role/molecule/default \
  "$fixture"/.github/workflows "$fixture"/docs
cat > "$fixture/ansible/playbooks/control-plane.yml" <<'YML'
- hosts: control_plane
  vars_files: [../vars/nodes.yml]
  roles:
    - role: shared_role
    - role: cp_role
  tasks:
    - ansible.builtin.copy:
        content: "{{ lookup('ansible.builtin.file', '../files/cp-only.conf') }}"
YML
cat > "$fixture/ansible/playbooks/worker-image.yml" <<'YML'
- hosts: workers
  vars_files: [../vars/nodes.yml, ../vars/worker_nodes.yml]
  roles:
    - role: shared_role
    - role: worker_role
  tasks:
    - ansible.builtin.copy:
        content: "{{ lookup('ansible.builtin.file', '../files/worker-only.conf') }}"
YML
cat > "$fixture/ansible/playbooks/node-shanghai-2.yml" <<'YML'
- hosts: shanghai-2
  tasks:
    - ansible.builtin.template:
        src: ../templates/shanghai-2.service.j2
YML
cat > "$fixture/ansible/playbooks/node-golyat-1.yml" <<'YML'
- hosts: golyat-1
YML
cat > "$fixture/ansible/playbooks/upgrade-k8s.yml" <<'YML'
- hosts: all
  roles:
    - role: upgrade_role
YML
cat > "$fixture/ansible/playbooks/worker-standalone.yml" <<'YML'
- hosts: workers
  tasks:
    - ansible.builtin.copy:
        content: "{{ lookup('ansible.builtin.file', '../files/worker-only.conf') }}"
YML
cat > "$fixture/ansible/playbooks/cp-extra.yml" <<'YML'
- hosts: control_plane
YML
# control-plane.yml imports cp-extra.yml
echo "- import_playbook: cp-extra.yml" >> "$fixture/ansible/playbooks/control-plane.yml"
echo "- ansible.builtin.copy: {src: ../files/role-asset.txt}" > "$fixture/ansible/roles/worker_role/tasks/main.yml"
echo "- debug: {}" > "$fixture/ansible/roles/upgrade_role/tasks/main.yml"
touch "$fixture/ansible/files/"{cp-only.conf,worker-only.conf,role-asset.txt,unreferenced.conf} \
  "$fixture/ansible/templates/shanghai-2.service.j2" \
  "$fixture/ansible/vars/nodes.yml" "$fixture/ansible/vars/worker_nodes.yml" "$fixture/ansible/vars/unused.yml" \
  "$fixture/ansible/inventories/production/hosts.yml" \
  "$fixture/ansible/group_vars/control_plane.yml" "$fixture/ansible/uv.lock" \
  "$fixture/ansible/README.md" "$fixture/ansible/.ansible-lint" "$fixture/ansible/tests/test_x.py" \
  "$fixture/ansible/roles/worker_role/README.md" "$fixture/ansible/roles/worker_role/molecule/default/converge.yml" \
  "$fixture/.github/workflows/apply-ansible.yml" "$fixture/docs/plan.md"

failures=0
total=0
ALL='["shanghai-1","shanghai-2","shanghai-3","golyat-4"]'
CP='["shanghai-1","shanghai-2","shanghai-3"]'
WORKER='["golyat-4"]'

check() {
  local name="$1" expected="$2" root="$3"
  shift 3
  local actual
  total=$((total + 1))
  if ! actual="$("$script" -C "$root" "$@" 2>/dev/null)"; then
    echo "FAIL $name: script exited non-zero" >&2
    failures=$((failures + 1))
    return
  fi
  if [ "$actual" != "$expected" ]; then
    echo "FAIL $name: expected $expected got $actual (files: $*)" >&2
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
}

# --- fixture tree -----------------------------------------------------------
check "no files -> none" '[]' "$fixture"
check "workflow/doc only -> none" '[]' "$fixture" .github/workflows/apply-ansible.yml docs/plan.md
check "control-plane.yml -> CP" "$CP" "$fixture" ansible/playbooks/control-plane.yml
check "worker-image.yml -> worker" "$WORKER" "$fixture" ansible/playbooks/worker-image.yml
check "node-shanghai-2.yml -> shanghai-2" '["shanghai-2"]' "$fixture" ansible/playbooks/node-shanghai-2.yml
check "node-golyat-1.yml (not an apply target) -> none" '[]' "$fixture" ansible/playbooks/node-golyat-1.yml
check "standalone playbook -> none" '[]' "$fixture" ansible/playbooks/upgrade-k8s.yml ansible/playbooks/worker-standalone.yml
check "imported playbook -> importer's nodes" "$CP" "$fixture" ansible/playbooks/cp-extra.yml
check "shared role -> all" "$ALL" "$fixture" ansible/roles/shared_role/tasks/main.yml
check "cp role -> CP" "$CP" "$fixture" ansible/roles/cp_role/tasks/main.yml
check "worker role -> worker" "$WORKER" "$fixture" ansible/roles/worker_role/tasks/main.yml
check "role used only by standalone playbook -> none" '[]' "$fixture" ansible/roles/upgrade_role/tasks/main.yml
check "role used nowhere -> all (fail closed)" "$ALL" "$fixture" ansible/roles/orphan_role/tasks/main.yml
check "role molecule/README -> none" '[]' "$fixture" ansible/roles/worker_role/molecule/default/converge.yml ansible/roles/worker_role/README.md
check "file referenced by worker playbooks -> worker" "$WORKER" "$fixture" ansible/files/worker-only.conf
check "file referenced by cp playbook -> CP" "$CP" "$fixture" ansible/files/cp-only.conf
check "file referenced via worker role -> worker" "$WORKER" "$fixture" ansible/files/role-asset.txt
check "template referenced by node playbook -> that node" '["shanghai-2"]' "$fixture" ansible/templates/shanghai-2.service.j2
check "unreferenced file -> all (fail closed)" "$ALL" "$fixture" ansible/files/unreferenced.conf
check "python bytecode under files/ -> none" '[]' "$fixture" ansible/files/__pycache__/verify_x.cpython-314.pyc ansible/files/stray.pyc
check "deleted (missing) file -> all (fail closed)" "$ALL" "$fixture" ansible/files/removed.conf
check "group_vars/control_plane.yml -> CP" "$CP" "$fixture" ansible/group_vars/control_plane.yml
check "vars loaded by cp + worker playbooks -> all" "$ALL" "$fixture" ansible/vars/nodes.yml
check "vars loaded by worker playbook only -> worker" "$WORKER" "$fixture" ansible/vars/worker_nodes.yml
check "vars loaded nowhere -> all (fail closed)" "$ALL" "$fixture" ansible/vars/unused.yml
check "inventory -> all" "$ALL" "$fixture" ansible/inventories/production/hosts.yml
check "uv.lock -> all" "$ALL" "$fixture" ansible/uv.lock
check "tests/md/lint -> none" '[]' "$fixture" ansible/tests/test_x.py ansible/README.md ansible/.ansible-lint
check "union keeps canonical order" "$ALL" "$fixture" ansible/playbooks/worker-image.yml ansible/playbooks/control-plane.yml
check "worker + cp-node union" '["shanghai-2","golyat-4"]' "$fixture" ansible/playbooks/worker-image.yml ansible/playbooks/node-shanghai-2.yml
check "worker change plus tests/docs stays worker" "$WORKER" "$fixture" ansible/playbooks/worker-image.yml ansible/tests/test_x.py docs/plan.md .github/workflows/apply-ansible.yml

# stdin form (space / newline separated, as emitted by tj-actions/changed-files)
total=$((total + 1))
actual="$(printf 'ansible/playbooks/worker-image.yml ansible/tests/test_x.py\ndocs/plan.md\n' | "$script" -C "$fixture" -)"
if [ "$actual" = "$WORKER" ]; then echo "ok   stdin form"; else echo "FAIL stdin form: got $actual" >&2; failures=$((failures + 1)); fi

# custom node list keeps group semantics
total=$((total + 1))
actual="$(ANSIBLE_APPLY_NODES="shanghai-1 golyat-4 golyat-5" "$script" -C "$fixture" ansible/playbooks/worker-image.yml)"
if [ "$actual" = '["golyat-4","golyat-5"]' ]; then echo "ok   custom node list"; else echo "FAIL custom node list: got $actual" >&2; failures=$((failures + 1)); fi

# --explain writes one line per file to stderr and nothing extra to stdout
total=$((total + 1))
explain="$("$script" -C "$fixture" --explain ansible/playbooks/worker-image.yml docs/plan.md 2>&1 >/dev/null)"
if [ "$explain" = $'ansible/playbooks/worker-image.yml -> golyat-4\ndocs/plan.md -> (no node)' ]; then
  echo "ok   explain output"
else
  echo "FAIL explain output: got: $explain" >&2; failures=$((failures + 1))
fi

# --nodes: explicit list is validated and canonically ordered
total=$((total + 1))
actual="$("$script" -C "$fixture" --nodes "golyat-4, shanghai-2")"
if [ "$actual" = '["shanghai-2","golyat-4"]' ]; then echo "ok   --nodes ordering"; else echo "FAIL --nodes ordering: got $actual" >&2; failures=$((failures + 1)); fi
for bad in "golyat-9" "" "shanghai-1,golyat-9"; do
  total=$((total + 1))
  if "$script" -C "$fixture" --nodes "$bad" >/dev/null 2>&1; then
    echo "FAIL --nodes '$bad' should be rejected" >&2; failures=$((failures + 1))
  else
    echo "ok   --nodes rejects '$bad'"
  fi
done
total=$((total + 1))
if "$script" -C "$fixture" --nodes golyat-4 ansible/uv.lock >/dev/null 2>&1; then
  echo "FAIL --nodes with files should be rejected" >&2; failures=$((failures + 1))
else
  echo "ok   --nodes rejects mixing with files"
fi

# --- real repository ----------------------------------------------------------
check "repo: workflow + scripts only -> none" '[]' "$repo_root" .github/workflows/apply-ansible.yml .github/scripts/ansible-apply-targets.sh .github/scripts/ansible-apply-targets.test.sh
check "repo: control-plane.yml -> CP" "$CP" "$repo_root" ansible/playbooks/control-plane.yml
check "repo: worker-image.yml -> worker" "$WORKER" "$repo_root" ansible/playbooks/worker-image.yml
check "repo: node-shanghai-1.yml -> shanghai-1" '["shanghai-1"]' "$repo_root" ansible/playbooks/node-shanghai-1.yml
check "repo: upgrade-k8s.yml + kubernetes_upgrade role -> none" '[]' "$repo_root" ansible/playbooks/upgrade-k8s.yml ansible/roles/kubernetes_upgrade/tasks/main.yml
check "repo: network_configuration role -> CP" "$CP" "$repo_root" ansible/roles/network_configuration/tasks/main.yml
check "repo: gpu_worker_host_tools role -> worker" "$WORKER" "$repo_root" ansible/roles/gpu_worker_host_tools/tasks/main.yml
check "repo: user_management role -> all" "$ALL" "$repo_root" ansible/roles/user_management/tasks/main.yml
check "repo: uv.lock -> all" "$ALL" "$repo_root" ansible/uv.lock
check "repo: vars/nodes.yml -> all" "$ALL" "$repo_root" ansible/vars/nodes.yml
check "repo: vars/worker_nodes.yml -> worker" "$WORKER" "$repo_root" ansible/vars/worker_nodes.yml
check "repo: group_vars/control_plane.yml -> CP" "$CP" "$repo_root" ansible/group_vars/control_plane.yml
# BOXP-269 P0 guard: the full file set of PR #13811 (worker-image pipeline
# variabilisation for golyat-1..3) must only ever apply to golyat-4, never to
# the control plane. Keep this list in sync with that PR if it grows.
check "repo: BOXP-269 P0 PR file set -> worker only" "$WORKER" "$repo_root" \
  .gitignore \
  .github/scripts/ansible-apply-targets.sh .github/scripts/ansible-apply-targets.test.sh \
  .github/workflows/apply-ansible.yml .github/workflows/build-worker-image.yml \
  ansible/playbooks/worker-image.yml \
  ansible/tests/test_verify_gpu_worker_image.py ansible/tests/test_worker_nodes.py \
  ansible/vars/worker_nodes.yml \
  docs/GPU_WORKER_IMAGE_DEPLOYMENT.md docs/project_docs/BOXP-267/plan-apply-ansible-targets.md docs/project_docs/BOXP-269/plan.md \
  scripts/images/build-gpu-worker-image.sh scripts/images/verify-gpu-worker-image-s3.sh \
  scripts/images/verify-gpu-worker-image-s3.test.sh scripts/images/verify-gpu-worker-image.sh scripts/images/worker-node-config.py

echo "$((total - failures))/$total passed"
[ "$failures" -eq 0 ]
