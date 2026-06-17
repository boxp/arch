# tfaction v2 aqua cleanup plan

## Goal

Remove top-level aqua tools that are no longer directly used after the tfaction v2 migration, while keeping tools still invoked by repository workflows.

## Findings

- tfaction v2 is a single action and its setup/plan/apply actions manage tfaction-specific helper tools such as `ci-info`, `tfcmt`, `tfmigrate`, `tfaction-go`, and `terraform-docs`.
- `github-comment`, `tfprovidercheck`, `conftest`, `ghalint`, `opa`, `actionlint`, `gh`, `cloudflared`, and `ansible-plan-formatter` are still invoked directly by repository workflows or actions and should remain in top-level aqua.
- `reviewdog` and `shellcheck` are runtime dependencies of `suzuki-shunsuke/github-action-actionlint` and should remain in top-level aqua.
- `ghcp` has no direct workflow or script usage in this repository.

## Steps

- [x] Audit workflow and script references for top-level aqua packages.
- [x] Remove unused or tfaction-managed top-level aqua imports.
- [x] Prune matching entries from `aqua/aqua-checksums.json`.
- [x] Keep the checksum workflow checkout ref fix for remaining standalone aqua update PRs.
- [x] Validate JSON and check for stale references.
