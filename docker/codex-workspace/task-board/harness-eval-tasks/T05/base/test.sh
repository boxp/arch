#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
fail=0
grep -Fxq '| LOG_LEVEL | ログの詳細度 | info |' runbook.md || { echo "FAIL: LOG_LEVEL row missing"; fail=1; }
grep -Fxq '| APP_PORT | 待受ポート | 8080 |' runbook.md || { echo "FAIL: APP_PORT row changed"; fail=1; }
grep -Fxq '| TZ | タイムゾーン | UTC |' runbook.md || { echo "FAIL: TZ row changed"; fail=1; }
[ "$(grep -c '^| ' runbook.md)" -eq 4 ] || { echo "FAIL: table row count"; fail=1; }
section() { awk -v h="$1" '$0==h{p=1;print;next} /^## /{p=0} p' runbook.md | sha256sum | cut -d" " -f1; }
[ "$(section '## 概要')" = "$(printf '## 概要\n\nsample-app は固定課題用の架空サービスである。\n\n' | sha256sum | cut -d' ' -f1)" ] || { echo "FAIL: 概要 changed"; fail=1; }
[ "$(section '## 手順')" = "$(printf '## 手順\n\n1. 設定を確認する。\n2. 起動する。\n\n' | sha256sum | cut -d' ' -f1)" ] || { echo "FAIL: 手順 changed"; fail=1; }
[ "$(section '## 注意')" = "$(printf '## 注意\n\n本番の値は別管理。\n' | sha256sum | cut -d' ' -f1)" ] || { echo "FAIL: 注意 changed"; fail=1; }
[ "$fail" -eq 0 ] && echo "PASS"
exit "$fail"
