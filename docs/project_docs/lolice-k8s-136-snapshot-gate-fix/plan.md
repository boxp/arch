# lolice k8s 1.36 snapshot gate fix plan

## Context

The `shanghai-1` production run for the 1.36 upgrade succeeded, but the follow-up PVC check showed zero `pre-upgrade-*.db` files in the `etcd-snapshots` Longhorn PVC.

The snapshot role could skip new snapshot creation when a same-day host-side file existed under `/var/lib/etcd-snapshots`, even if the Longhorn PVC had no snapshot. That lets the upgrade gate pass without the expected PVC backup.

## Plan

1. Treat the Longhorn PVC as the authoritative reusable snapshot location.
2. Stop using host-only existing snapshots as a reason to skip new snapshot creation.
3. Reuse a same-day PVC snapshot only when it exists in the snapshot store pod.
4. Always verify the selected PVC snapshot is non-empty before allowing the upgrade workflow to continue.
5. Add a Molecule fixture with a host-only snapshot so the regression is covered.

## Validation

- Run Ansible lint on the changed role and Molecule files.
- Run the `kubernetes_upgrade` Molecule scenario if the local environment supports it.
- After merge, rerun the production snapshot gate for the next node and verify the PVC has a non-empty `pre-upgrade-*.db` before continuing the 1.36 upgrade.
