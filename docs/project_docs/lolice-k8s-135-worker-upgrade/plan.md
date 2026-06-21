# lolice k8s 1.35 worker upgrade

## Goal

Enable the existing Kubernetes Upgrade workflow to upgrade lolice worker nodes to Kubernetes 1.35 one node at a time.

## Scope

- Add `golyat-1`, `golyat-2`, and `golyat-3` to the production Ansible inventory as worker nodes.
- Enable the worker upgrade play in `playbooks/upgrade-k8s.yml`.
- Ensure worker health checks use a control-plane kubeconfig instead of expecting `/etc/kubernetes/admin.conf` on workers.
- Add worker targets to `.github/workflows/upgrade-k8s.yml`.
- Keep etcd snapshots on the Longhorn PVC during upgrades; cleanup is a final Phase 5 task after all nodes are stable.

## Execution policy

- Run workflow dispatch with one explicit `target_node` per execution.
- Verify the upgraded node is Ready and at the requested kubelet version before starting the next node.
- Do not use the `all` target for this Phase 4 production rollout.

## Validation

- `ansible-playbook --syntax-check` for `playbooks/upgrade-k8s.yml`.
- `uv run ansible-lint` for the touched playbook and role tasks.
- `actionlint` / `ghalint run` for workflow changes.
