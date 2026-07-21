# PR #11331: Worker secret verification

## Plan

1. Add a `null_resource` that runs after Worker script updates and confirms the required secret names are bound through the Cloudflare API.
2. Update the member portal README to document the automatic verification and CI failure behavior.
3. Format and validate the Terraform configuration, then commit and push the changes to the PR branch.
