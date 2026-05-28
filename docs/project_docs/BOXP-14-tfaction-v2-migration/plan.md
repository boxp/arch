# BOXP-14 tfaction v2 migration plan

## Goal

Migrate `boxp/arch` from `suzuki-shunsuke/tfaction` v1.20.1 to v2.0.0 on Renovate PR #9620 and make the PR reviewable.

## Scope

- Update `.github/workflows` tfaction calls to the v2 single-action form.
- Replace `run: tfaction ...` invocations with the v2 action form.
- Update `tfaction-root.yaml` for v2 schema and matching behavior.
- Add explicit cloud authentication after `tfaction setup`.
- Remove v1-only secret export and SSH key setup behavior.
- Remove module scaffold/test workflows that v2 no longer supports.
- Update scaffold template placeholders to Handlebars syntax.

## Steps

- [x] Convert `uses: suzuki-shunsuke/tfaction/<action>@...` to `uses: suzuki-shunsuke/tfaction@...` with `with.action`.
- [x] Convert drift command invocations to action calls.
- [x] Add `id: setup` and explicit `aws-actions/configure-aws-credentials` steps after setup in plan/apply/drift jobs.
- [x] Pass GitHub secrets through supported tfaction inputs instead of using `export-secrets`.
- [x] Add `TFACTION_SKIP_TERRAFORM` to plan/apply jobs.
- [x] Remove `wc-test-module.yaml` usage and `scaffold-module.yaml`.
- [x] Update `tfaction-root.yaml` fields: `plan_workflow_name`, `available_providers`, `conftest`, `working_directory` globs, `auto_apps`.
- [x] Replace `%%TARGET%%` placeholders in templates.
- [x] Run workflow syntax checks with `actionlint` where available.

## Risks

- `export-secrets` removal changes how provider tokens are injected; plan/apply must receive required secrets explicitly.
- v2 target matching uses glob/exact behavior, so target discovery must be verified after changing `working_directory`.
- Renovate branch already includes broad dependency updates, so keep migration edits scoped and avoid changing unrelated lockfiles.
