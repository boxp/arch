# lolice k8s 1.35 reuse etcd snapshot plan

## Goal

- Reuse an existing same-day etcd snapshot in the `etcd-snapshots` Longhorn PVC during Kubernetes upgrade runs.
- Avoid taking a new etcd snapshot for every worker node when a valid upgrade snapshot already exists.
- Keep the existing behavior of creating a new snapshot when no same-day PVC snapshot exists.

## Scope

- Remove forced `etcd_snapshot_force=true` from the Kubernetes Upgrade workflow production snapshot step.
- Teach `kubernetes_upgrade` to look for a same-day `pre-upgrade-*.db` in the Longhorn PVC and skip new snapshot creation when one exists.
- Verify reused PVC snapshots are non-empty before allowing the upgrade workflow to continue.

## Validation

- `cd ansible && uv run ansible-lint`
- `actionlint .github/workflows/upgrade-k8s.yml`
- `ghalint run .github/workflows/upgrade-k8s.yml`
- syntax-check `playbooks/upgrade-k8s.yml` with v1.35 inputs
- `cd ansible/roles/kubernetes_upgrade && PATH=../../.venv/bin:$PATH ../../.venv/bin/molecule test`
- production `--tags etcd_snapshot` dry validation: reused existing PVC snapshot and skipped new etcd snapshot creation
