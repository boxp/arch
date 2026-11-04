#!/usr/bin/env bash
# T05 受入: 試行ディレクトリ内の test.sh だけで判定する。
set -euo pipefail
cd "$1"
bash test.sh
