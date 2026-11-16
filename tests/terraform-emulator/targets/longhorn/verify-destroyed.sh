#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091 # Paths are resolved from HARNESS_DIR at runtime.
source "${HARNESS_DIR}/lib.sh"
failed=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS: $1"; else
  echo "FAIL: $1 ($2)"
  failed=1
fi; }
buckets=$(aws s3api list-buckets --query 'Buckets[].Name' --output text)
users=$(aws iam list-users --query 'Users[].UserName' --output text)
parameters=$(aws ssm describe-parameters --query 'Parameters[].Name' --output text)
check buckets "$buckets" ''
# IAM access keys belong to a user; deleting the only test user removes its keys.
check users-and-access-keys "$users" emulator
check parameters "$parameters" ''
exit "$failed"
