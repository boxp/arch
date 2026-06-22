# lolice k8s 1.36 avoid baseline downgrade plan

## Context

After merging the 1.36 snapshot gate fix, the normal `Apply Ansible` workflow failed on `shanghai-1`.

`shanghai-1` had already been upgraded to Kubernetes `1.36.1`, while the normal apply baseline still declares `1.35.6-1.1`. The `kubernetes_components` role tried to install the older package versions during normal apply, which would be a downgrade. APT refused because the Kubernetes packages are held, so the node was not downgraded.

## Plan

1. Keep the upgrade workflow as the path for explicit Kubernetes version changes.
2. Make normal apply skip Kubernetes packages that are already newer than the declared baseline.
3. Continue installing missing packages or upgrading packages older than the baseline.
4. Allow held packages to change for baseline upgrades after the rolling cluster upgrade is complete.
5. Keep package holds in place after normal apply.

## Validation

- Run Ansible lint for `kubernetes_components`.
- Run the `kubernetes_components` Molecule scenario locally.
- Confirm the next main `Apply Ansible` no longer attempts to downgrade `shanghai-1`.
