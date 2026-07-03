# lolice k8s 1.35 worker drain delegate plan

## Goal

- Avoid repeating the `golyat-2` upgrade failure where worker drain delegated to `shanghai-1` became unreachable.
- Keep worker upgrades one node at a time.
- Leave control-plane upgrade behavior unchanged.

## Scope

- Add `kubernetes_worker_drain_delegate` with a default of the second control-plane node when available.
- Use that delegate for worker drain and uncordon tasks.
- Keep the value overrideable for future maintenance runs.

## Validation

- `cd ansible && uv run ansible-lint`
- syntax-check `playbooks/upgrade-k8s.yml` with v1.35 inputs
