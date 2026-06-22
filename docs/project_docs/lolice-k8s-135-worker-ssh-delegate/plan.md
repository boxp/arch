# lolice k8s 1.35 worker SSH delegate plan

## Goal

- Ensure worker upgrade jobs can SSH to the control-plane host used for worker drain and uncordon.
- Keep worker upgrades one node at a time.
- Avoid changing package upgrade behavior.

## Scope

- Align worker job SSH config with `kubernetes_worker_drain_delegate`.
- Use `shanghai-2` as the worker drain delegate host in worker job SSH setup and verification.
- Apply the same SSH setup to all worker jobs.

## Validation

- `actionlint .github/workflows/upgrade-k8s.yml`
- `ghalint run .github/workflows/upgrade-k8s.yml`
