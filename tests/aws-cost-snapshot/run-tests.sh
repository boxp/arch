#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
bb tests/aws-cost-snapshot/test.bb
