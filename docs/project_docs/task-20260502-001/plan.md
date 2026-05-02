# task-20260502-001: Renovate plan drift follow-up PR

## Goal

When a Renovate PR hits unrelated Terraform drift such as token rotation, create a separate PR that applies the drift before the Renovate PR is merged.

## Background

PR #8650 updates only aqua files, but `terraform/cloudflare/b0xp.io/grafana` plan reports `time_rotating.token_rotation` creation. Because tfaction requires Renovate PRs to be no-change, the Renovate PR is blocked. Forcing the Renovate PR through later causes apply to fail because the plan artifact is not available for the drifted state.

## Approach

- Keep tfaction's Renovate no-change safeguard.
- Do not mark the Renovate plan as successful.
- On Renovate plan failure, create a follow-up PR from the base branch.
- The follow-up PR only updates `<target>/.tfaction/failed-prs`, so tfaction plans/applies the affected target without including the Renovate dependency update.
- If the follow-up plan only contains expected drift such as token rotation, merge it first and rerun/rebase the Renovate PR.

## Scope

- Add a reusable script for creating the Renovate plan follow-up PR.
- Call it from `wc-plan.yaml` only for failed `pull_request_target` runs from `renovate[bot]`.
