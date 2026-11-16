#!/usr/bin/env bash
# T03 受入: 試行ディレクトリ内の test.bb だけで判定する。
set -euo pipefail
cd "$1"
bb test.bb
