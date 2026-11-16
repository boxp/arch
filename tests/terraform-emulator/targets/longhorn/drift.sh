#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091 # Paths are resolved from HARNESS_DIR at runtime.
source "${HARNESS_DIR}/lib.sh"
aws s3api put-public-access-block --bucket boxp-longhorn-backup --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=true
aws iam put-user-policy --user-name longhorn-backup-user --policy-name longhorn-backup-policy --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}'
