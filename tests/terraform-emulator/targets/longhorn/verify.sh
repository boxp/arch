#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091 # Paths are resolved from HARNESS_DIR at runtime.
source "${HARNESS_DIR}/lib.sh"
failed=0
check() {
  local name=$1 actual=$2 expected=$3
  if [[ "$actual" == "$expected" ]]; then echo "PASS: $name"; else
    echo "FAIL: $name (actual: $actual, expected: $expected)"
    failed=1
  fi
}
check versioning "$(aws s3api get-bucket-versioning --bucket boxp-longhorn-backup --query Status --output text)" Enabled
check public-access "$(aws s3api get-public-access-block --bucket boxp-longhorn-backup --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,BlockPublicPolicy,IgnorePublicAcls,RestrictPublicBuckets]' --output text)" $'True\tTrue\tTrue\tTrue'
check encryption "$(aws s3api get-bucket-encryption --bucket boxp-longhorn-backup --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text)" AES256
check user-path "$(aws iam get-user --user-name longhorn-backup-user --query User.Path --output text)" /system/
check user-tag "$(aws iam list-user-tags --user-name longhorn-backup-user --query "Tags[?Key=='Project'].Value | [0]" --output text)" lolice
check policy-names "$(aws iam list-user-policies --user-name longhorn-backup-user --query 'PolicyNames[]' --output text)" longhorn-backup-policy
check policy-version "$(aws iam get-user-policy --user-name longhorn-backup-user --policy-name longhorn-backup-policy --query PolicyDocument.Version --output text)" 2012-10-17
check policy-count "$(aws iam get-user-policy --user-name longhorn-backup-user --policy-name longhorn-backup-policy --query 'length(PolicyDocument.Statement)' --output text)" 2
for spec in 'arn:aws:s3:::boxp-longhorn-backup|s3:GetBucketLocation s3:ListBucket' 'arn:aws:s3:::boxp-longhorn-backup/*|s3:DeleteObject s3:GetObject s3:PutObject'; do
  resource=${spec%%|*}
  expected=${spec#*|}
  check "policy $resource" "$(aws iam get-user-policy --user-name longhorn-backup-user --policy-name longhorn-backup-policy --query "PolicyDocument.Statement[?Resource=='$resource' && Effect=='Allow'].Action[]" --output text | tr '\t' '\n' | sort | xargs)" "$expected"
done
key=$(aws iam list-access-keys --user-name longhorn-backup-user --query 'AccessKeyMetadata[0].AccessKeyId' --output text)
check access-key-count "$(aws iam list-access-keys --user-name longhorn-backup-user --query 'length(AccessKeyMetadata)' --output text)" 1
for spec in 'aws-access-key-id|SecureString' 'aws-secret-access-key|SecureString' 'aws-endpoints|String'; do
  name=${spec%%|*}
  type=${spec#*|}
  check "parameter $name type" "$(aws ssm get-parameter --name "/longhorn/backup/$name" --query Parameter.Type --output text)" "$type"
done
check access-key-value "$(aws ssm get-parameter --name /longhorn/backup/aws-access-key-id --with-decryption --query Parameter.Value --output text)" "$key"
secret=$(aws ssm get-parameter --name /longhorn/backup/aws-secret-access-key --with-decryption --query Parameter.Value --output text)
if [[ -n "$secret" && "$secret" != None ]]; then echo 'PASS: secret value present'; else
  echo 'FAIL: secret value missing'
  failed=1
fi
check endpoint "$(aws ssm get-parameter --name /longhorn/backup/aws-endpoints --query Parameter.Value --output text)" s3.amazonaws.com
exit "$failed"
