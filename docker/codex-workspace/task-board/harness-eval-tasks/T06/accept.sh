#!/usr/bin/env bash
# T06 受入: 試行ディレクトリ内の test.bb と独立検査 check.bb で判定する。
set -euo pipefail
cd "$1"
bb test.bb
bb check.bb
