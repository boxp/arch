# Codex workspace SSH environment propagation

## Problem

Kubernetes injects `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `DOCKER_HOST`,
and related variables into the codex-workspace container, but SSH login sessions
started by `sshd` do not automatically inherit the container process
environment. As a result, Codex sessions started over SSH cannot see the
Grafana MCP token or Docker daemon endpoint.

## Plan

- Write selected runtime environment variables to a boxp-owned session env file
  under `/run/codex-workspace`.
- Install a profile snippet that sources that file for SSH login shells.
- Preserve the container environment when starting `even-terminal` so non-SSH
  sessions keep the same runtime values.

## Validation

- `bash -n docker/codex-workspace/entrypoint.sh`
