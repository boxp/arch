#!/usr/bin/env bash
# 指定ファイルの行数を lines=N の形式で出す。
set -eu
file="$1"
n=$(wc -l < "$file")
echo "lines=$n"
